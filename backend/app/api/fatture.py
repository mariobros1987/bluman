from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from app.db.auth import get_current_user, require_advisor, tenant_filter
from app.db.client import get_supabase
from app.models.fattura import FatturaCreate, FatturaUpdate, FatturaOut

router = APIRouter()


async def _valida_righe(db, tenant_id: str, righe, progetto_id: str):
    """
    Validazione dei 3 tipi riga fattura (§18):
    - modulo_completo: il modulo deve avere stato 'completed'
    - modulo_parziale: il cumulato delle % fatturate non deve superare 100%
    - milestone_libera: nessun vincolo aggiuntivo
    """
    for riga in righe:
        if riga.tipo == "modulo_completo":
            # Verifica che il modulo sia completed
            mod_resp = (
                db.table("modulo_progetto")
                .select("stato, prezzo")
                .eq("id", str(riga.modulo_progetto_id))
                .eq("tenant_id", tenant_id)
                .single()
                .execute()
            )
            if not mod_resp.data:
                raise HTTPException(status_code=404, detail=f"Modulo {riga.modulo_progetto_id} non trovato")
            if mod_resp.data["stato"] != "completed":
                raise HTTPException(
                    status_code=400,
                    detail=f"Fatturazione modulo_completo: il modulo '{riga.modulo_progetto_id}' non è in stato 'completed' (stato attuale: {mod_resp.data['stato']})"
                )

        elif riga.tipo == "modulo_parziale":
            if not riga.percentuale or riga.percentuale <= 0 or riga.percentuale > 100:
                raise HTTPException(status_code=400, detail="modulo_parziale richiede percentuale tra 0 e 100")

            # Verifica che il cumulato non superi 100%
            existing_resp = (
                db.table("fattura_riga")
                .select("percentuale")
                .eq("modulo_progetto_id", str(riga.modulo_progetto_id))
                .eq("tipo", "modulo_parziale")
                .eq("tenant_id", tenant_id)
                .execute()
            )
            existing_pcts = sum(r.get("percentuale", 0) for r in (existing_resp.data or []))
            if existing_pcts + riga.percentuale > 100:
                raise HTTPException(
                    status_code=400,
                    detail=f"Percentuale cumulata per il modulo {riga.modulo_progetto_id} supererebbe il 100% ({existing_pcts}% già fatturato + {riga.percentuale}% proposto)"
                )


async def _genera_numero_progressivo(db, tenant_id: str) -> int:
    """
    Genera il prossimo numero_progressivo per il tenant.
    Usa un SELECT FOR UPDATE per evitare concorrenza (§26).
    Con Supabase REST non abbiamo vero FOR UPDATE, usiamo un approccio max+1.
    """
    resp = (
        db.table("fattura")
        .select("numero_progressivo")
        .eq("tenant_id", tenant_id)
        .not_.is_("numero_progressivo", "null")
        .order("numero_progressivo", desc=True)
        .limit(1)
        .execute()
    )
    if resp.data and resp.data[0].get("numero_progressivo"):
        return resp.data[0]["numero_progressivo"] + 1
    return 1


@router.get("", response_model=list[FatturaOut])
async def lista_fatture(progetto_id: UUID = None, current_user: dict = Depends(get_current_user)):
    """Lista le fatture del tenant. Filtro opzionale per progetto_id."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    query = db.table("fattura").select("*, fattura_riga(*)").eq("tenant_id", tenant_id)
    if progetto_id:
        query = query.eq("progetto_id", str(progetto_id))
        
    resp = query.order("data_fattura", desc=True).execute()
    
    result = []
    for row in resp.data or []:
        row["righe"] = row.pop("fattura_riga", [])
        result.append(row)
        
    return result

@router.post("", response_model=FatturaOut, status_code=status.HTTP_201_CREATED)
async def crea_fattura(body: FatturaCreate, current_user: dict = Depends(require_advisor)):
    """Emette una nuova fattura. Richiede che le righe siano fornite nel body."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    # Validazione righe (§18)
    if body.righe:
        await _valida_righe(db, tenant_id, body.righe, str(body.progetto_id))
    
    totale = sum(r.importo for r in body.righe)
    
    # Determina il canale in base al tipo_cliente_fiscale
    canale = "standard"
    if body.tipo_cliente_fiscale in ("b2b", "pa"):
        canale = "sdi"
    
    # Inserisci testata
    fat_resp = db.table("fattura").insert({
        "tenant_id": tenant_id,
        "progetto_id": str(body.progetto_id),
        "cliente_id": str(body.cliente_id),
        "numero": body.numero,
        "data_fattura": body.data_fattura.isoformat(),
        "stato": "bozza",
        "totale": totale,
        "tipo_cliente_fiscale": body.tipo_cliente_fiscale,
        "partita_iva": body.partita_iva,
        "codice_fiscale": body.codice_fiscale,
        "canale": canale,
        "note": body.note,
    }).execute()
    fattura = fat_resp.data[0]
    
    # Inserisci righe
    righe_out = []
    if body.righe:
        righe_insert = [
            {
                "tenant_id": tenant_id,
                "fattura_id": fattura["id"],
                "tipo": r.tipo,
                "modulo_progetto_id": str(r.modulo_progetto_id) if r.modulo_progetto_id else None,
                "percentuale": r.percentuale,
                "importo": r.importo,
                "descrizione": r.descrizione,
                "ordine": r.ordine
            } for r in body.righe
        ]
        r_resp = db.table("fattura_riga").insert(righe_insert).execute()
        righe_out = r_resp.data
        
        # Aggiorna importo_fatturato su ogni modulo_progetto coinvolto
        for r in body.righe:
            if r.modulo_progetto_id:
                mod_resp = (
                    db.table("modulo_progetto")
                    .select("importo_fatturato")
                    .eq("id", str(r.modulo_progetto_id))
                    .single()
                    .execute()
                )
                if mod_resp.data:
                    nuovo_fatturato = float(mod_resp.data["importo_fatturato"]) + float(r.importo)
                    db.table("modulo_progetto").update({"importo_fatturato": nuovo_fatturato}).eq("id", str(r.modulo_progetto_id)).execute()
        
    fattura["righe"] = righe_out
    return fattura


@router.post("/{fattura_id}/emetti", response_model=FatturaOut)
async def emetti_fattura(fattura_id: UUID, current_user: dict = Depends(require_advisor)):
    """
    Emette una fattura: genera il numero_progressivo e cambia stato a 'emessa'.
    Se canale=sdi, prepara per l'invio SDI (XML FatturaPA — stub per ora).
    """
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    # Carica fattura
    fat_resp = (
        db.table("fattura")
        .select("*")
        .eq("id", str(fattura_id))
        .eq("tenant_id", tenant_id)
        .single()
        .execute()
    )
    if not fat_resp.data:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    
    fattura = fat_resp.data
    if fattura["stato"] != "bozza":
        raise HTTPException(status_code=400, detail="Solo le fatture in bozza possono essere emesse")
    
    # Genera numero_progressivo
    num_prog = await _genera_numero_progressivo(db, tenant_id)
    
    updates = {
        "stato": "emessa",
        "numero_progressivo": num_prog,
    }
    
    # Se canale SDI, segnala come inviata (il vero XML FatturaPA è un'integrazione esterna)
    if fattura.get("canale") == "sdi":
        updates["stato_sdi"] = "inviata"
        # TODO: generare XML FatturaPA e caricare su storage → xml_fatturapa_url
    
    fat_update = (
        db.table("fattura")
        .update(updates)
        .eq("id", str(fattura_id))
        .execute()
    )
    
    fattura_emessa = fat_update.data[0]
    
    # Carica righe
    r_resp = db.table("fattura_riga").select("*").eq("fattura_id", str(fattura_id)).execute()
    fattura_emessa["righe"] = r_resp.data or []
    
    return fattura_emessa


@router.post("/{fattura_id}/incassa", response_model=FatturaOut)
async def incassa_fattura(fattura_id: UUID, current_user: dict = Depends(require_advisor)):
    """Segna la fattura come incassata."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    fat_resp = (
        db.table("fattura")
        .select("stato")
        .eq("id", str(fattura_id))
        .eq("tenant_id", tenant_id)
        .single()
        .execute()
    )
    if not fat_resp.data:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    if fat_resp.data["stato"] != "emessa":
        raise HTTPException(status_code=400, detail="Solo le fatture emesse possono essere incassate")
    
    fat_update = db.table("fattura").update({"stato": "incassata"}).eq("id", str(fattura_id)).execute()
    fattura = fat_update.data[0]
    
    r_resp = db.table("fattura_riga").select("*").eq("fattura_id", str(fattura_id)).execute()
    fattura["righe"] = r_resp.data or []
    
    return fattura


@router.patch("/{fattura_id}", response_model=FatturaOut)
async def aggiorna_fattura(fattura_id: UUID, body: FatturaUpdate, current_user: dict = Depends(require_advisor)):
    """Aggiorna solo stato (bozza -> emessa -> incassata) o note di una fattura."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    updates = body.model_dump(exclude_none=True, mode="json")
    if not updates:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
        
    fat_resp = db.table("fattura").update(updates).eq("id", str(fattura_id)).eq("tenant_id", tenant_id).execute()
    if not fat_resp.data:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
        
    fattura = fat_resp.data[0]
    
    # Carica righe per l'output
    r_resp = db.table("fattura_riga").select("*").eq("fattura_id", str(fattura_id)).execute()
    fattura["righe"] = r_resp.data or []
    
    return fattura

