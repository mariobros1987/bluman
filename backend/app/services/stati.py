def calcola_percentuale_microvoce(m: dict) -> float:
    """Calcola la percentuale di una singola microvoce (max 99 se non è done)."""
    stato = m["stato"]
    if stato == "done":
        return 100.0
    if stato in ("pending", "attesa_dipendenza"):
        return 0.0
    
    ore_prev = m.get("ore_preventivate", 0)
    ore_cons = m.get("ore_consuntivate", 0)
    if ore_prev <= 0:
        return 0.0
        
    return min(99.0, (ore_cons / ore_prev) * 100.0)

async def ricalcola_stato_modulo(db, tenant_id: str, modulo_id: str):
    """Ricalcola avanzamento_pct e stato complessivo del modulo in base alle microvoci."""
    mvs_resp = (
        db.table("microvoce_progetto")
        .select("*")
        .eq("modulo_progetto_id", modulo_id)
        .eq("tenant_id", tenant_id)
        .execute()
    )
    mvs = mvs_resp.data or []
    
    if not mvs:
        return
        
    tot_ore_prev = sum(m["ore_preventivate"] for m in mvs)
    tot_ore_cons = sum(m["ore_consuntivate"] for m in mvs)
    stati = [m["stato"] for m in mvs]
    
    # 1. Calcolo percentuale modulo
    avanzamento_pct = 0
    if tot_ore_prev > 0:
        # Media pesata sulle percentuali delle singole microvoci
        somma_pesata = sum(calcola_percentuale_microvoce(m) * m["ore_preventivate"] for m in mvs)
        avanzamento_pct = somma_pesata / tot_ore_prev
        
    # 2. Calcolo stato modulo (precedenza: blocked > delayed > done > attesa_dipendenza > in_progress > pending)
    nuovo_stato = "pending"
    if "blocked" in stati:
        nuovo_stato = "blocked"
    elif "delayed" in stati:
        nuovo_stato = "delayed"
    elif all(s == "done" for s in stati):
        nuovo_stato = "completed"
    elif all(s == "attesa_dipendenza" for s in stati):
        nuovo_stato = "attesa_dipendenza"
    elif any(s in ("active", "done", "at_risk", "in_progress") for s in stati):
        nuovo_stato = "in_progress"
        
    mod_updated = db.table("modulo_progetto").update({
        "stato": nuovo_stato,
        "avanzamento_pct": round(avanzamento_pct, 2),
        "ore_consuntivate": tot_ore_cons
    }).eq("id", modulo_id).execute()
    
    modulo_info = mod_updated.data[0] if mod_updated.data else None
    
    if modulo_info:
        await ricalcola_stato_progetto(db, tenant_id, modulo_info["progetto_id"])
        if nuovo_stato == "completed":
            await risolvi_dipendenze(db, tenant_id, modulo_info["progetto_id"])



async def aggiorna_stato_microvoce(db, tenant_id: str, microvoce_id: str, updates: dict) -> dict:
    """Aggiorna microvoce, calcola at_risk se si sfora, propaga stati al modulo."""
    mv_resp = (
        db.table("microvoce_progetto")
        .select("*")
        .eq("id", microvoce_id)
        .eq("tenant_id", tenant_id)
        .single()
        .execute()
    )
    mv = mv_resp.data
    if not mv:
        raise ValueError("Microvoce non trovata")
        
    nuovo_stato = updates.get("stato", mv["stato"])
    ore_consuntivate = mv["ore_consuntivate"]
    
    if "ore_consuntivate_increment" in updates:
        ore_consuntivate += updates["ore_consuntivate_increment"]
        updates["ore_consuntivate"] = ore_consuntivate
        del updates["ore_consuntivate_increment"]
        
    # Check causa_nota per delayed/blocked (domain rule §16.4)
    if nuovo_stato in ("delayed", "blocked") and mv["stato"] != nuovo_stato:
        causa = updates.get("causa_nota")
        if not causa or not causa.strip():
            from fastapi import HTTPException
            raise HTTPException(
                status_code=400,
                detail=f"causa_nota è obbligatoria quando lo stato passa a {nuovo_stato} (§7bis)"
            )
        updates["causa_nota"] = causa.strip()
    
    # Se risolviamo il ritardo manuale tornando active, puliamo la nota
    if nuovo_stato == "active" and mv["stato"] in ("delayed", "blocked"):
        updates["causa_nota"] = None

    # Calcolo at_risk automatico (il segnale di rischio)
    if nuovo_stato not in ("done", "delayed", "blocked"):
        if ore_consuntivate > mv["ore_preventivate"]:
            nuovo_stato = "at_risk"
            updates["stato"] = nuovo_stato
            
    # Aggiorna microvoce
    mv_update_resp = db.table("microvoce_progetto").update(updates).eq("id", microvoce_id).execute()
    mv_updated = mv_update_resp.data[0]
    
    # Propaga l'aggiornamento al modulo padre
    await ricalcola_stato_modulo(db, tenant_id, mv["modulo_progetto_id"])
    
    return mv_updated


async def ricalcola_stato_progetto(db, tenant_id: str, progetto_id: str):
    """Ricalcola avanzamento_pct e stato complessivo del progetto in base ai moduli."""
    moduli_resp = (
        db.table("modulo_progetto")
        .select("*")
        .eq("progetto_id", progetto_id)
        .eq("tenant_id", tenant_id)
        .execute()
    )
    moduli = moduli_resp.data or []
    
    if not moduli:
        return
        
    tot_ore_prev = sum(m["ore_preventivate"] for m in moduli)
    
    avanzamento_pct = 0
    if tot_ore_prev > 0:
        # Avanzamento = media pesata sulle percentuali dei singoli moduli (domain rule §16.3)
        somma_pesata = sum(m["ore_preventivate"] * (m["avanzamento_pct"] / 100) for m in moduli)
        avanzamento_pct = (somma_pesata / tot_ore_prev) * 100
        
    stati = [m["stato"] for m in moduli]
    
    nuovo_stato = "pre_project"
    if len(stati) > 0 and all(s == "completed" for s in stati):
        nuovo_stato = "completed"
    elif len(stati) > 0:
        nuovo_stato = "in_progress"
        
    db.table("progetto").update({
        "stato": nuovo_stato,
        "avanzamento_pct": round(avanzamento_pct, 2)
    }).eq("id", progetto_id).execute()


async def risolvi_dipendenze(db, tenant_id: str, progetto_id: str):
    """
    Risolve le dipendenze in modo idempotente. 
    Sblocca i moduli (e le loro micro-voci) il cui stato è 'attesa_dipendenza'
    se tutti i moduli da cui dipendono sono 'completed'.
    """
    # Trova tutti i moduli in attesa_dipendenza
    moduli_in_attesa = (
        db.table("modulo_progetto")
        .select("id")
        .eq("progetto_id", progetto_id)
        .eq("tenant_id", tenant_id)
        .eq("stato", "attesa_dipendenza")
        .execute()
    ).data or []
    
    for mod in moduli_in_attesa:
        mod_id = mod["id"]
        
        # Trova da chi dipende questo modulo
        deps = (
            db.table("modulo_progetto_dipendenza")
            .select("dipende_da_modulo_progetto_id")
            .eq("modulo_progetto_id", mod_id)
            .execute()
        ).data or []
        
        dipendenze_ids = [d["dipende_da_modulo_progetto_id"] for d in deps]
        
        if not dipendenze_ids:
            # Nessuna dipendenza, non dovrebbe essere in attesa_dipendenza, sblocco
            await sblocca_modulo(db, tenant_id, mod_id)
            continue
            
        # Verifica lo stato delle dipendenze
        deps_stati = (
            db.table("modulo_progetto")
            .select("stato")
            .in_("id", dipendenze_ids)
            .execute()
        ).data or []
        
        if all(d["stato"] == "completed" for d in deps_stati):
            # Tutte le dipendenze completate, sblocco modulo
            await sblocca_modulo(db, tenant_id, mod_id)

async def sblocca_modulo(db, tenant_id: str, modulo_id: str):
    """Cambia lo stato del modulo e delle sue micro-voci da 'attesa_dipendenza' a 'pending'."""
    db.table("modulo_progetto").update({"stato": "pending"}).eq("id", modulo_id).execute()
    
    # Sblocca le micro-voci collegate che sono in attesa_dipendenza
    db.table("microvoce_progetto").update({"stato": "pending"}).eq("modulo_progetto_id", modulo_id).eq("stato", "attesa_dipendenza").execute()
