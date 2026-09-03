from fastapi import APIRouter, Depends, HTTPException
from app.db.auth import get_current_user
from app.db.client import get_supabase
from app.models.user import UserOut

router = APIRouter()

@router.get("/me", response_model=UserOut)
async def get_me(current_user: dict = Depends(get_current_user)):
    """Restituisce il profilo dell'utente corrente (dalla tabella 'user')."""
    db = get_supabase()
    user_id = current_user["user_id"]
    
    resp = (
        db.table("user")
        .select("*")
        .eq("id", user_id)
        .single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Profilo utente non trovato nel database")
        
    return resp.data
