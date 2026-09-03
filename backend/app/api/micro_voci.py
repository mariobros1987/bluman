from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from app.db.auth import get_current_user, require_advisor, tenant_filter
from app.db.client import get_supabase
from app.models.microvoce import MicrovoceUpdate, MicrovoceOut
from app.services.stati import aggiorna_stato_microvoce

router = APIRouter()

@router.patch("/{microvoce_id}", response_model=MicrovoceOut)
async def aggiorna_microvoce(
    microvoce_id: UUID, 
    body: MicrovoceUpdate, 
    current_user: dict = Depends(get_current_user)
):
    """
    Consuntiva ore e/o cambia lo stato di una microvoce.
    Usa il motore stati (services/stati) per ricalcolare automaticamente at_risk 
    e propagare l'avanzamento al modulo padre.
    """
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    updates = body.model_dump(exclude_none=True, mode="json")
    if not updates:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
        
    # Controlli di business
    if updates.get("stato") in ("delayed", "blocked") and not updates.get("causa_nota"):
        # Controlliamo se c'è già una nota sul DB
        mv_resp = (
            db.table("microvoce_progetto")
            .select("causa_nota")
            .eq("id", str(microvoce_id))
            .single()
            .execute()
        )
        if not mv_resp.data or not mv_resp.data.get("causa_nota"):
            raise HTTPException(
                status_code=400, 
                detail="Nota obbligatoria per spostare lo stato a delayed o blocked"
            )
            
    # Se lo stato diventa 'done', valida che tutti i passaggi_progetto siano stati completati (§17.1)
    if updates.get("stato") == "done":
        passaggi_resp = (
            db.table("passaggio_progetto")
            .select("id, stato")
            .eq("microvoce_progetto_id", str(microvoce_id))
            .eq("tenant_id", tenant_id)
            .execute()
        )
        if passaggi_resp.data:
            pending_count = sum(1 for p in passaggi_resp.data if p.get("stato") != "done")
            if pending_count > 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Impossibile completare l'attività: ci sono ancora {pending_count} passaggi in sospeso."
                )

    try:
        updated = await aggiorna_stato_microvoce(db, tenant_id, str(microvoce_id), updates)
        return updated
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
