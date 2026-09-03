from uuid import UUID
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from app.db.auth import get_current_user, tenant_filter
from app.db.client import get_supabase
from app.models.passaggio import PassaggioProgettoCreate, PassaggioProgettoUpdate, PassaggioProgettoOut

router = APIRouter()

@router.get("/microvoce/{microvoce_id}", response_model=List[PassaggioProgettoOut])
async def lista_passaggi_microvoce(
    microvoce_id: UUID,
    current_user: dict = Depends(get_current_user)
):
    """Restituisce tutti i passaggi associati ad una microvoce ordinati."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    res = (
        db.table("passaggio_progetto")
        .select("*")
        .eq("microvoce_progetto_id", str(microvoce_id))
        .eq("tenant_id", tenant_id)
        .order("ordine", desc=False)
        .execute()
    )
    return res.data or []

@router.post("/microvoce/{microvoce_id}", response_model=PassaggioProgettoOut)
async def crea_passaggio_microvoce(
    microvoce_id: UUID,
    body: PassaggioProgettoCreate,
    current_user: dict = Depends(get_current_user)
):
    """Crea un nuovo passaggio per l'istanza della microvoce."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    # Calcola ordine max
    max_res = (
        db.table("passaggio_progetto")
        .select("ordine")
        .eq("microvoce_progetto_id", str(microvoce_id))
        .eq("tenant_id", tenant_id)
        .order("ordine", desc=True)
        .limit(1)
        .execute()
    )
    next_ordine = (max_res.data[0]["ordine"] + 1) if max_res.data else 0
    
    payload = body.model_dump(exclude_none=True)
    payload.update({
        "tenant_id": tenant_id,
        "microvoce_progetto_id": str(microvoce_id),
        "ordine": next_ordine,
        "stato": "pending"
    })
    
    res = db.table("passaggio_progetto").insert(payload).execute()
    if not res.data:
        raise HTTPException(status_code=400, detail="Errore nella creazione del passaggio")
    return res.data[0]

@router.patch("/{passaggio_id}", response_model=PassaggioProgettoOut)
async def aggiorna_passaggio(
    passaggio_id: UUID,
    body: PassaggioProgettoUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Aggiorna uno step/passaggio (es. marca completato, invia form, collega documento)."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    updates = body.model_dump(exclude_none=True, mode="json")
    if not updates:
        raise HTTPException(status_code=400, detail="Nessun dato fornito per l'aggiornamento")
        
    res = (
        db.table("passaggio_progetto")
        .update(updates)
        .eq("id", str(passaggio_id))
        .eq("tenant_id", tenant_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Passaggio non trovato")
    return res.data[0]

@router.delete("/{passaggio_id}", status_code=status.HTTP_204_NO_CONTENT)
async def elimina_passaggio(
    passaggio_id: UUID,
    current_user: dict = Depends(get_current_user)
):
    """Elimina un passaggio dall'istanza della microvoce."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    db.table("passaggio_progetto").delete().eq("id", str(passaggio_id)).eq("tenant_id", tenant_id).execute()
    return None
