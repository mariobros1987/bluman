"""
Router: Preventivi
Endpoints:
  GET    /api/preventivi              → lista preventivi del tenant
  POST   /api/preventivi              → crea nuovo preventivo
  GET    /api/preventivi/{id}         → dettaglio
  PATCH  /api/preventivi/{id}         → aggiorna (solo se bozza)
  POST   /api/preventivi/{id}/invia   → passa a stato 'inviato' (email al cliente)
  POST   /api/preventivi/{id}/accetta → ACCETTAZIONE: crea progetto + engagement letter
  POST   /api/preventivi/{id}/rifiuta → passa a stato 'rifiutato'
  DELETE /api/preventivi/{id}         → elimina (solo se bozza)
"""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status

from app.db.auth import get_current_user, require_advisor, tenant_filter
from app.db.client import get_supabase
from app.models.preventivo import (
    PreventivoCreate,
    PreventivoUpdate,
    PreventivoOut,
    AccettazioneResult,
)
from app.services.preventivo import accetta_preventivo

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────

def _calcola_valore(righe: list[dict]) -> float:
    return sum(float(r.get("prezzo_proposto", 0)) for r in righe)


def _get_preventivo_o_404(db, preventivo_id: UUID, tenant_id: str) -> dict:
    resp = (
        db.table("preventivo")
        .select("*")
        .eq("id", str(preventivo_id))
        .eq("tenant_id", tenant_id)
        .single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Preventivo non trovato")
    return resp.data


# ── Endpoints ─────────────────────────────────────────────────

@router.get("", response_model=list[PreventivoOut])
async def lista_preventivi(
    stato: str | None = None,
    cliente_id: UUID | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Lista preventivi del tenant corrente. Filtrabile per stato e cliente."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()

    query = db.table("preventivo").select("*").eq("tenant_id", tenant_id)
    if stato:
        query = query.eq("stato", stato)
    if cliente_id:
        query = query.eq("cliente_id", str(cliente_id))

    resp = query.order("created_at", desc=True).execute()
    return resp.data or []


@router.post("", response_model=PreventivoOut, status_code=status.HTTP_201_CREATED)
async def crea_preventivo(
    body: PreventivoCreate,
    current_user: dict = Depends(require_advisor),
):
    """Crea un nuovo preventivo in stato 'bozza'."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()

    righe = [r.model_dump(mode="json") for r in body.righe]
    valore = _calcola_valore(righe)

    resp = (
        db.table("preventivo")
        .insert({
            "tenant_id": tenant_id,
            "cliente_id": str(body.cliente_id),
            "creato_da": current_user["user_id"],
            "stato": "bozza",
            "titolo": body.titolo,
            "note": body.note,
            "righe": righe,
            "valore_totale": valore,
        })
        .execute()
    )
    return resp.data[0]


@router.get("/{preventivo_id}", response_model=PreventivoOut)
async def dettaglio_preventivo(
    preventivo_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    """Dettaglio di un singolo preventivo."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    return _get_preventivo_o_404(db, preventivo_id, tenant_id)


@router.patch("/{preventivo_id}", response_model=PreventivoOut)
async def aggiorna_preventivo(
    preventivo_id: UUID,
    body: PreventivoUpdate,
    current_user: dict = Depends(require_advisor),
):
    """Aggiorna un preventivo. Solo se in stato 'bozza'."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()

    prev = _get_preventivo_o_404(db, preventivo_id, tenant_id)
    if prev["stato"] != "bozza":
        raise HTTPException(
            status_code=400,
            detail=f"Non puoi modificare un preventivo in stato '{prev['stato']}'. Solo le bozze sono modificabili."
        )

    updates: dict = {}
    if body.titolo is not None:
        updates["titolo"] = body.titolo
    if body.note is not None:
        updates["note"] = body.note
    if body.righe is not None:
        righe = [r.model_dump(mode="json") for r in body.righe]
        updates["righe"] = righe
        updates["valore_totale"] = _calcola_valore(righe)

    if not updates:
        return prev

    resp = (
        db.table("preventivo")
        .update(updates)
        .eq("id", str(preventivo_id))
        .execute()
    )
    return resp.data[0]


@router.post("/{preventivo_id}/invia", response_model=PreventivoOut)
async def invia_preventivo(
    preventivo_id: UUID,
    current_user: dict = Depends(require_advisor),
):
    """Passa il preventivo a stato 'inviato' (e invia email al cliente)."""
    from datetime import datetime, timezone
    tenant_id = tenant_filter(current_user)
    db = get_supabase()

    prev = _get_preventivo_o_404(db, preventivo_id, tenant_id)
    if prev["stato"] != "bozza":
        raise HTTPException(
            status_code=400,
            detail=f"Solo i preventivi in bozza possono essere inviati. Stato attuale: '{prev['stato']}'"
        )

    now = datetime.now(timezone.utc).isoformat()
    resp = (
        db.table("preventivo")
        .update({"stato": "inviato", "inviato_at": now})
        .eq("id", str(preventivo_id))
        .execute()
    )

    # TODO: invia email al cliente con link di accettazione
    # await email_service.invia_preventivo(prev, current_user)

    return resp.data[0]


@router.post("/{preventivo_id}/accetta", response_model=AccettazioneResult)
async def accetta_preventivo_endpoint(
    preventivo_id: UUID,
    current_user: dict = Depends(require_advisor),
):
    """
    ACCETTAZIONE PREVENTIVO — Azione principale.

    Esegue in sequenza:
    1. Preventivo → stato 'accettato'
    2. Crea Progetto (stato: pre_project)
    3. Istanzia ModuloProgetto + MicroVoceProgetto dal template
    4. Copia grafo dipendenze
    5. Crea Engagement Letter
    6. Invia via DocuSign (se configurato)
    """
    tenant_id = tenant_filter(current_user)

    try:
        result = await accetta_preventivo(
            preventivo_id=preventivo_id,
            tenant_id=UUID(tenant_id),
            user_id=UUID(current_user["user_id"]),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        **result,
        "messaggio": "Preventivo accettato. Progetto creato e engagement letter inviata per firma."
    }


@router.post("/{preventivo_id}/rifiuta", response_model=PreventivoOut)
async def rifiuta_preventivo(
    preventivo_id: UUID,
    current_user: dict = Depends(require_advisor),
):
    """Passa il preventivo a stato 'rifiutato'."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()

    prev = _get_preventivo_o_404(db, preventivo_id, tenant_id)
    if prev["stato"] not in ("bozza", "inviato"):
        raise HTTPException(
            status_code=400,
            detail=f"Non puoi rifiutare un preventivo in stato '{prev['stato']}'"
        )

    resp = (
        db.table("preventivo")
        .update({"stato": "rifiutato"})
        .eq("id", str(preventivo_id))
        .execute()
    )
    return resp.data[0]


@router.delete("/{preventivo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def elimina_preventivo(
    preventivo_id: UUID,
    current_user: dict = Depends(require_advisor),
):
    """Elimina un preventivo. Solo se in stato 'bozza'."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()

    prev = _get_preventivo_o_404(db, preventivo_id, tenant_id)
    if prev["stato"] != "bozza":
        raise HTTPException(
            status_code=400,
            detail="Solo le bozze possono essere eliminate."
        )

    db.table("preventivo").delete().eq("id", str(preventivo_id)).execute()
