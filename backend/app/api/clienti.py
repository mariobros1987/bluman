from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from app.db.auth import get_current_user, require_advisor, tenant_filter
from app.db.client import get_supabase
from app.models.cliente import ClienteCreate, ClienteUpdate, ClienteOut

router = APIRouter()

def _get_cliente_o_404(db, cliente_id: UUID, tenant_id: str) -> dict:
    resp = (
        db.table("cliente")
        .select("*")
        .eq("id", str(cliente_id))
        .eq("tenant_id", tenant_id)
        .single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Cliente non trovato")
    return resp.data

@router.get("", response_model=list[ClienteOut])
async def lista_clienti(current_user: dict = Depends(get_current_user)):
    """Restituisce tutti i clienti del tenant corrente."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    resp = db.table("cliente").select("*").eq("tenant_id", tenant_id).order("nome").execute()
    return resp.data or []

@router.post("", response_model=ClienteOut, status_code=status.HTTP_201_CREATED)
async def crea_cliente(body: ClienteCreate, current_user: dict = Depends(require_advisor)):
    """Crea un nuovo cliente per il tenant (solo advisor)."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    referenti_json = [r.model_dump(mode="json") for r in body.referenti]
    
    resp = (
        db.table("cliente")
        .insert({
            "tenant_id": tenant_id,
            "nome": body.nome,
            "tipo": body.tipo,
            "email": body.email,
            "telefono": body.telefono,
            "note": body.note,
            "referenti": referenti_json,
        })
        .execute()
    )
    return resp.data[0]

@router.get("/{cliente_id}", response_model=ClienteOut)
async def dettaglio_cliente(cliente_id: UUID, current_user: dict = Depends(get_current_user)):
    """Restituisce il dettaglio di un cliente."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    return _get_cliente_o_404(db, cliente_id, tenant_id)

@router.patch("/{cliente_id}", response_model=ClienteOut)
async def aggiorna_cliente(cliente_id: UUID, body: ClienteUpdate, current_user: dict = Depends(require_advisor)):
    """Aggiorna i dati di un cliente."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    _get_cliente_o_404(db, cliente_id, tenant_id)
    
    updates = body.model_dump(exclude_none=True, mode="json")
    if not updates:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
        
    resp = (
        db.table("cliente")
        .update(updates)
        .eq("id", str(cliente_id))
        .execute()
    )
    return resp.data[0]

@router.delete("/{cliente_id}", status_code=status.HTTP_204_NO_CONTENT)
async def elimina_cliente(cliente_id: UUID, current_user: dict = Depends(require_advisor)):
    """Elimina un cliente."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    _get_cliente_o_404(db, cliente_id, tenant_id)
    
    db.table("cliente").delete().eq("id", str(cliente_id)).execute()
