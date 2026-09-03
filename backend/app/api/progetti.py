"""
Router: Progetti
Endpoints:
  GET    /api/progetti                    → lista progetti del tenant
  GET    /api/progetti/{id}               → dettaglio progetto
  PATCH  /api/progetti/{id}              → aggiorna (nome, date, note)
  GET    /api/progetti/{id}/moduli        → lista moduli del progetto
  POST   /api/progetti/{id}/avanza        → forza stato progetto a in_progress (dopo firma DocuSign)
  POST   /api/webhook/docusign            → webhook DocuSign: firma ricevuta → progetto in_progress
"""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.db.auth import get_current_user, require_advisor, tenant_filter
from app.db.client import get_supabase
from app.models.preventivo import ProgettoOut, ProgettoUpdate

router = APIRouter()


def _get_progetto_o_404(db, progetto_id: UUID, tenant_id: str) -> dict:
    resp = (
        db.table("progetto")
        .select("*")
        .eq("id", str(progetto_id))
        .eq("tenant_id", tenant_id)
        .single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Progetto non trovato")
    return resp.data


# ── Endpoints ─────────────────────────────────────────────────

@router.get("", response_model=list[ProgettoOut])
async def lista_progetti(
    stato: str | None = None,
    cliente_id: UUID | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Lista progetti del tenant. Filtrabile per stato e cliente."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()

    query = db.table("progetto").select("*").eq("tenant_id", tenant_id)
    if stato:
        query = query.eq("stato", stato)
    if cliente_id:
        query = query.eq("cliente_id", str(cliente_id))

    resp = query.order("created_at", desc=True).execute()
    return resp.data or []


@router.get("/{progetto_id}", response_model=ProgettoOut)
async def dettaglio_progetto(
    progetto_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    return _get_progetto_o_404(db, progetto_id, tenant_id)


@router.patch("/{progetto_id}", response_model=ProgettoOut)
async def aggiorna_progetto(
    progetto_id: UUID,
    body: ProgettoUpdate,
    current_user: dict = Depends(require_advisor),
):
    """Aggiorna nome, date, note del progetto."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    _get_progetto_o_404(db, progetto_id, tenant_id)

    updates = body.model_dump(exclude_none=True, mode="json")
    if not updates:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")

    resp = (
        db.table("progetto")
        .update(updates)
        .eq("id", str(progetto_id))
        .execute()
    )
    return resp.data[0]


@router.get("/{progetto_id}/moduli")
async def lista_moduli_progetto(
    progetto_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    """Lista moduli di un progetto con le relative micro-voci."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    _get_progetto_o_404(db, progetto_id, tenant_id)

    moduli_resp = (
        db.table("modulo_progetto")
        .select("*, microvoce_progetto(*)")
        .eq("progetto_id", str(progetto_id))
        .eq("tenant_id", tenant_id)
        .order("ordine")
        .execute()
    )
    return moduli_resp.data or []


@router.post("/{progetto_id}/avanza", response_model=ProgettoOut)
async def avanza_a_in_progress(
    progetto_id: UUID,
    current_user: dict = Depends(require_advisor),
):
    """
    Passa il progetto da pre_project a in_progress.
    Chiamato manualmente dall'advisor o automaticamente via webhook DocuSign.
    """
    from datetime import date
    tenant_id = tenant_filter(current_user)
    db = get_supabase()

    progetto = _get_progetto_o_404(db, progetto_id, tenant_id)
    if progetto["stato"] != "pre_project":
        raise HTTPException(
            status_code=400,
            detail=f"Il progetto è già in stato '{progetto['stato']}'"
        )

    resp = (
        db.table("progetto")
        .update({
            "stato": "in_progress",
            "data_inizio": date.today().isoformat(),
        })
        .eq("id", str(progetto_id))
        .execute()
    )
    return resp.data[0]


# ── Webhook DocuSign ──────────────────────────────────────────

@router.post("/webhook/docusign", include_in_schema=False)
async def docusign_webhook(request: Request):
    """
    Webhook ricevuto da DocuSign quando il cliente firma l'engagement letter.
    Aggiorna stato engagement_letter → firmata e progetto → in_progress.
    """
    from datetime import datetime, timezone, date

    # DocuSign invia XML o JSON a seconda della configurazione
    # Leggi il body come JSON (Connect configurato in JSON)
    try:
        payload = await request.json()
    except Exception:
        return {"status": "ignored"}

    event = payload.get("event", "")
    if event != "envelope-completed":
        return {"status": "ignored", "event": event}

    envelope_id = payload.get("data", {}).get("envelopeId") or payload.get("envelopeId")
    if not envelope_id:
        return {"status": "no_envelope_id"}

    db = get_supabase()
    now = datetime.now(timezone.utc).isoformat()

    # Trova l'engagement letter con questo envelope
    el_resp = (
        db.table("engagement_letter")
        .select("*")
        .eq("docusign_envelope_id", envelope_id)
        .execute()
    )
    el_list = el_resp.data or []
    if not el_list:
        return {"status": "envelope_not_found"}

    el = el_list[0]

    # Aggiorna engagement letter → firmata
    db.table("engagement_letter").update({
        "stato_firma": "firmata",
        "firmata_at": now,
    }).eq("id", el["id"]).execute()

    # Aggiorna progetto → in_progress
    if el.get("progetto_id"):
        db.table("progetto").update({
            "stato": "in_progress",
            "data_inizio": date.today().isoformat(),
        }).eq("id", el["progetto_id"]).execute()

    return {"status": "ok", "progetto_id": el.get("progetto_id")}


# ── Team Progetto (Fase 11 — §24) ─────────────────────────────

@router.get("/{progetto_id}/team")
async def team_progetto(
    progetto_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    """
    Aggregazione team: per ogni collaboratore assegnato ai moduli del progetto,
    restituisce ore consuntivate e micro-voci completate.
    """
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    _get_progetto_o_404(db, progetto_id, tenant_id)

    # Carica tutti i moduli con il team assegnato
    team_resp = (
        db.table("modulo_progetto_team")
        .select("user_id, modulo_progetto!inner(progetto_id)")
        .eq("modulo_progetto.progetto_id", str(progetto_id))
        .execute()
    )
    
    # Carica micro-voci con risorsa_id per aggregare
    mvs_resp = (
        db.table("microvoce_progetto")
        .select("risorsa_id, ore_consuntivate, stato, modulo_progetto!inner(progetto_id)")
        .eq("modulo_progetto.progetto_id", str(progetto_id))
        .eq("tenant_id", tenant_id)
        .execute()
    )
    
    # Aggrega per risorsa_id
    team_map: dict[str, dict] = {}
    for mv in (mvs_resp.data or []):
        rid = mv.get("risorsa_id")
        if not rid:
            continue
        if rid not in team_map:
            team_map[rid] = {"user_id": rid, "ore_consuntivate": 0, "micro_voci_totali": 0, "micro_voci_completate": 0}
        team_map[rid]["ore_consuntivate"] += float(mv.get("ore_consuntivate", 0))
        team_map[rid]["micro_voci_totali"] += 1
        if mv.get("stato") == "done":
            team_map[rid]["micro_voci_completate"] += 1
    
    # Arricchisci con dati utente
    result = []
    for uid, data in team_map.items():
        user_resp = db.table("user").select("nome, email, avatar_ini, colore").eq("id", uid).single().execute()
        if user_resp.data:
            data.update(user_resp.data)
        result.append(data)

    return result


# ── Fatturazione Progetto (Fase 9 — §12) ──────────────────────

@router.get("/{progetto_id}/fatturazione")
async def fatturazione_progetto(
    progetto_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    """
    Stato di fatturazione del progetto: per ogni modulo restituisce
    prezzo, importo_fatturato e residuo.
    """
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    progetto = _get_progetto_o_404(db, progetto_id, tenant_id)

    moduli_resp = (
        db.table("modulo_progetto")
        .select("id, nome, categoria, prezzo, importo_fatturato, stato")
        .eq("progetto_id", str(progetto_id))
        .eq("tenant_id", tenant_id)
        .order("ordine")
        .execute()
    )
    moduli = moduli_resp.data or []

    totale_progetto = float(progetto.get("valore_totale", 0))
    totale_fatturato = sum(float(m.get("importo_fatturato", 0)) for m in moduli)
    residuo = totale_progetto - totale_fatturato

    dettaglio = []
    for m in moduli:
        prezzo = float(m.get("prezzo", 0))
        fatturato = float(m.get("importo_fatturato", 0))
        dettaglio.append({
            "modulo_progetto_id": m["id"],
            "nome": m["nome"],
            "categoria": m.get("categoria"),
            "stato": m["stato"],
            "prezzo": prezzo,
            "importo_fatturato": fatturato,
            "residuo_modulo": prezzo - fatturato,
        })

    return {
        "progetto_id": str(progetto_id),
        "valore_totale": totale_progetto,
        "totale_fatturato": totale_fatturato,
        "residuo": residuo,
        "moduli": dettaglio,
    }

