from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from app.db.auth import get_current_user, require_advisor, tenant_filter
from app.db.client import get_supabase
from app.models.evento_calendario import EventoCalendarioCreate, EventoCalendarioUpdate, EventoCalendarioOut

router = APIRouter()


@router.get("", response_model=list[EventoCalendarioOut])
async def lista_eventi(
    progetto_id: UUID = None,
    current_user: dict = Depends(get_current_user)
):
    """Lista gli eventi del calendario per il tenant. Filtro opzionale per progetto_id."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()

    query = db.table("evento_calendario").select("*").eq("tenant_id", tenant_id)
    if progetto_id:
        query = query.eq("progetto_id", str(progetto_id))

    resp = query.order("data_inizio").execute()
    return resp.data or []


@router.post("", response_model=EventoCalendarioOut, status_code=status.HTTP_201_CREATED)
async def crea_evento(body: EventoCalendarioCreate, current_user: dict = Depends(get_current_user)):
    """Crea un nuovo evento nel calendario."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()

    resp = db.table("evento_calendario").insert({
        "tenant_id": tenant_id,
        "user_id": current_user["user_id"],
        "progetto_id": str(body.progetto_id) if body.progetto_id else None,
        "titolo": body.titolo,
        "descrizione": body.descrizione,
        "data_inizio": body.data_inizio.isoformat(),
        "data_fine": body.data_fine.isoformat() if body.data_fine else None,
        "tutto_giorno": body.tutto_giorno,
    }).execute()

    return resp.data[0]


@router.patch("/{evento_id}", response_model=EventoCalendarioOut)
async def aggiorna_evento(
    evento_id: UUID,
    body: EventoCalendarioUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Aggiorna un evento del calendario."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()

    updates = body.model_dump(exclude_none=True, mode="json")
    if not updates:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")

    # Serializza datetime
    for k in ("data_inizio", "data_fine"):
        if k in updates and updates[k] is not None:
            updates[k] = updates[k].isoformat() if hasattr(updates[k], 'isoformat') else updates[k]

    resp = (
        db.table("evento_calendario")
        .update(updates)
        .eq("id", str(evento_id))
        .eq("tenant_id", tenant_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Evento non trovato")

    return resp.data[0]


@router.delete("/{evento_id}", status_code=status.HTTP_204_NO_CONTENT)
async def elimina_evento(evento_id: UUID, current_user: dict = Depends(get_current_user)):
    """Elimina un evento del calendario."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()

    resp = (
        db.table("evento_calendario")
        .select("id")
        .eq("id", str(evento_id))
        .eq("tenant_id", tenant_id)
        .single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Evento non trovato")

    db.table("evento_calendario").delete().eq("id", str(evento_id)).execute()
