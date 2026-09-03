"""
Service: logica di accettazione del preventivo.

Quando un preventivo viene accettato:
1. Il preventivo passa a stato 'accettato'
2. Viene creato un Progetto (stato: pre_project)
3. Vengono istanziati i ModuloProgetto (uno per ogni riga del preventivo)
4. Vengono istanziate le MicroVoceProgetto (copiate dal template)
5. Viene copiato il grafo dipendenze dal template
6. Viene creata l'Engagement Letter
7. DocuSign invia l'envelope per la firma (o placeholder se non configurato)
"""
from __future__ import annotations
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from app.db.client import get_supabase
from app.services.docusign import invia_engagement_letter_docusign


async def accetta_preventivo(
    preventivo_id: UUID,
    tenant_id: UUID,
    user_id: UUID,
) -> dict:
    """
    Transazione logica di accettazione preventivo.
    Restituisce dict con: preventivo, progetto, engagement_letter.
    """
    db = get_supabase()
    now = datetime.now(timezone.utc).isoformat()

    # 1. Carica il preventivo e verifica che sia in stato valido
    prev_resp = (
        db.table("preventivo")
        .select("*")
        .eq("id", str(preventivo_id))
        .eq("tenant_id", str(tenant_id))
        .single()
        .execute()
    )
    prev = prev_resp.data
    if not prev:
        raise ValueError("Preventivo non trovato")
    if prev["stato"] not in ("bozza", "inviato"):
        raise ValueError(f"Impossibile accettare un preventivo in stato '{prev['stato']}'")

    # 2. Aggiorna preventivo → accettato
    db.table("preventivo").update({
        "stato": "accettato",
        "accettato_at": now,
    }).eq("id", str(preventivo_id)).execute()

    # 3. Calcola valore totale dalle righe
    righe: list[dict] = prev.get("righe", [])
    valore_totale = sum(Decimal(str(r.get("prezzo_proposto", 0))) for r in righe)

    # 4. Crea il Progetto
    nome_progetto = prev.get("titolo") or f"Progetto — {prev['cliente_id']}"
    prog_resp = (
        db.table("progetto")
        .insert({
            "tenant_id": str(tenant_id),
            "cliente_id": prev["cliente_id"],
            "preventivo_id": str(preventivo_id),
            "nome": nome_progetto,
            "stato": "pre_project",
            "valore_totale": float(valore_totale),
            "note": prev.get("note"),
        })
        .execute()
    )
    progetto = prog_resp.data[0]
    progetto_id = progetto["id"]

    # 5. Istanzia moduli e micro-voci per ogni riga del preventivo
    await _istanzia_moduli(db, tenant_id, progetto_id, righe)

    # 6. Crea Engagement Letter (senza DocuSign per ora)
    el_resp = (
        db.table("engagement_letter")
        .insert({
            "tenant_id": str(tenant_id),
            "preventivo_id": str(preventivo_id),
            "progetto_id": progetto_id,
            "stato_firma": "in_attesa",
        })
        .execute()
    )
    engagement_letter = el_resp.data[0]

    # 7. Invia via DocuSign (async, non bloccante — gestisce il caso di credenziali mancanti)
    try:
        docusign_result = await invia_engagement_letter_docusign(
            engagement_letter_id=engagement_letter["id"],
            tenant_id=str(tenant_id),
            preventivo=prev,
            progetto=progetto,
        )
        if docusign_result:
            db.table("engagement_letter").update({
                "docusign_envelope_id": docusign_result.get("envelope_id"),
                "docusign_signing_url": docusign_result.get("signing_url"),
                "stato_firma": "inviata",
                "inviata_at": now,
            }).eq("id", engagement_letter["id"]).execute()
            engagement_letter.update({
                "docusign_envelope_id": docusign_result.get("envelope_id"),
                "docusign_signing_url": docusign_result.get("signing_url"),
                "stato_firma": "inviata",
                "inviata_at": now,
            })
    except Exception as e:
        # DocuSign non configurato o errore: logga ma non blocca il flusso
        print(f"[DocuSign] Engagement letter non inviata via DocuSign: {e}")

    # Ricarica preventivo aggiornato
    prev_updated = (
        db.table("preventivo")
        .select("*")
        .eq("id", str(preventivo_id))
        .single()
        .execute()
    ).data

    return {
        "preventivo": prev_updated,
        "progetto": progetto,
        "engagement_letter": engagement_letter,
    }


async def _istanzia_moduli(
    db,
    tenant_id: UUID,
    progetto_id: str,
    righe: list[dict],
) -> None:
    """
    Per ogni riga del preventivo:
    - Crea ModuloProgetto (copia congelata del template)
    - Crea MicroVoceProgetto (copiate dal template)
    - Copia il grafo dipendenze dal template
    """
    # Mappa modulo_template_id -> modulo_progetto_id (per le dipendenze)
    template_to_progetto: dict[str, str] = {}

    for ordine, riga in enumerate(righe):
        template_id = riga.get("modulo_template_id")
        template_ver = riga.get("modulo_template_versione", 1)

        # Crea ModuloProgetto
        mod_resp = (
            db.table("modulo_progetto")
            .insert({
                "tenant_id": str(tenant_id),
                "progetto_id": progetto_id,
                "modulo_template_id": template_id,
                "modulo_template_versione": template_ver,
                "nome": riga["nome"],
                "categoria": riga.get("categoria", ""),
                "prezzo": float(riga.get("prezzo_proposto", 0)),
                "ore_preventivate": float(riga.get("ore", 0)),
                "stato": "pending",
                "ordine": ordine,
            })
            .execute()
        )
        modulo_prog = mod_resp.data[0]
        modulo_prog_id = modulo_prog["id"]
        template_to_progetto[str(template_id)] = modulo_prog_id

        # Carica micro-voci dal template
        mv_resp = (
            db.table("microvoce_template")
            .select("*")
            .eq("modulo_template_id", str(template_id))
            .order("ordine")
            .execute()
        )
        micro_voci_template = mv_resp.data or []

        # Crea MicroVoceProgetto e copia i passaggi_template se presenti
        if micro_voci_template:
            for mv in micro_voci_template:
                mv_ins_resp = db.table("microvoce_progetto").insert({
                    "tenant_id": str(tenant_id),
                    "modulo_progetto_id": modulo_prog_id,
                    "nome": mv["nome"],
                    "ordine": mv["ordine"],
                    "ore_preventivate": float(mv.get("ore_default", 0)),
                    "stato": "pending",
                }).execute()
                
                if mv_ins_resp.data:
                    mv_prog_id = mv_ins_resp.data[0]["id"]
                    # Copia passaggi template per questa microvoce
                    pt_resp = db.table("passaggio_template").select("*").eq("microvoce_template_id", mv["id"]).order("ordine").execute()
                    passaggi_tpl = pt_resp.data or []
                    if passaggi_tpl:
                        passaggi_ins = [
                            {
                                "tenant_id": str(tenant_id),
                                "microvoce_progetto_id": mv_prog_id,
                                "titolo": pt["titolo"],
                                "tipo": pt["tipo"],
                                "chi": pt["chi"],
                                "ordine": pt["ordine"],
                                "descrizione": pt.get("descrizione"),
                                "campi_form_json": pt.get("campi_form_json", []),
                                "stato": "pending"
                            }
                            for pt in passaggi_tpl
                        ]
                        db.table("passaggio_progetto").insert(passaggi_ins).execute()

    # Copia grafo dipendenze dal template (versione del progetto)
    if template_to_progetto:
        template_ids = list(template_to_progetto.keys())
        deps_resp = (
            db.table("modulo_dipendenza_template")
            .select("*")
            .eq("tenant_id", str(tenant_id))
            .in_("modulo_template_id", template_ids)
            .in_("dipende_da_modulo_template_id", template_ids)
            .execute()
        )
        deps = deps_resp.data or []

        if deps:
            deps_insert = [
                {
                    "tenant_id": str(tenant_id),
                    "modulo_progetto_id": template_to_progetto[dep["modulo_template_id"]],
                    "dipende_da_modulo_progetto_id": template_to_progetto[dep["dipende_da_modulo_template_id"]],
                }
                for dep in deps
                if dep["modulo_template_id"] in template_to_progetto
                and dep["dipende_da_modulo_template_id"] in template_to_progetto
            ]
            if deps_insert:
                db.table("modulo_progetto_dipendenza").insert(deps_insert).execute()
                
                # Imposta 'attesa_dipendenza' sui moduli che dipendono da altri
                moduli_dipendenti_ids = list(set(d["modulo_progetto_id"] for d in deps_insert))
                if moduli_dipendenti_ids:
                    db.table("modulo_progetto").update({"stato": "attesa_dipendenza"}).in_("id", moduli_dipendenti_ids).execute()
                    db.table("microvoce_progetto").update({"stato": "attesa_dipendenza"}).in_("modulo_progetto_id", moduli_dipendenti_ids).execute()
