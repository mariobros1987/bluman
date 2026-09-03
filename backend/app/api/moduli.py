from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from app.db.auth import get_current_user, require_advisor, tenant_filter
from app.db.client import get_supabase
from app.models.modulo import ModuloProgettoUpdate, ModuloProgettoOut

router = APIRouter()

@router.get("/progetto/{progetto_id}")
async def lista_moduli_progetto(
    progetto_id: UUID,
    current_user: dict = Depends(get_current_user)
):
    """
    Ritorna la lista dei moduli di un progetto, incluse le micro-voci.
    """
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    # Supabase (Postgrest) supporta select("*, microvoce_progetto(*)")
    resp = (
        db.table("modulo_progetto")
        .select("*, microvoce_progetto(*)")
        .eq("progetto_id", str(progetto_id))
        .eq("tenant_id", tenant_id)
        .order("created_at")
        .execute()
    )
    
    return resp.data or []

@router.patch("/{modulo_id}", response_model=ModuloProgettoOut)
async def aggiorna_modulo(
    modulo_id: UUID, 
    body: ModuloProgettoUpdate, 
    current_user: dict = Depends(require_advisor)
):
    """
    Aggiornamento manuale del modulo. 
    Attenzione: stato e avanzamento_pct vengono di solito calcolati 
    dal motore stati in base alle micro-voci (services/stati.py).
    """
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    updates = body.model_dump(exclude_none=True, mode="json")
    if not updates:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
        
    resp = (
        db.table("modulo_progetto")
        .update(updates)
        .eq("id", str(modulo_id))
        .eq("tenant_id", tenant_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Modulo non trovato")
        
    return resp.data[0]
