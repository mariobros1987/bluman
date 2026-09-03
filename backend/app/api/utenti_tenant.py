from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from app.db.auth import get_current_user, require_advisor, tenant_filter
from app.db.client import get_supabase
from app.models.user import UserOut

router = APIRouter()


@router.get("", response_model=list[UserOut])
async def lista_utenti_tenant(current_user: dict = Depends(require_advisor)):
    """Lista tutti gli utenti del tenant corrente (solo advisor)."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()

    resp = (
        db.table("user")
        .select("*")
        .eq("tenant_id", tenant_id)
        .order("nome")
        .execute()
    )
    return resp.data or []


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def invita_utente(
    nome: str,
    email: str,
    ruolo: str = "collaboratore_interno",
    current_user: dict = Depends(require_advisor),
):
    """
    Invita un nuovo utente (collaboratore) al tenant.
    L'utente viene creato in stato 'invitato'.
    L'auth Supabase creerà le credenziali via invite email.
    """
    tenant_id = tenant_filter(current_user)
    db = get_supabase()

    # Verifica che l'email non sia già presente nel tenant
    existing = (
        db.table("user")
        .select("id")
        .eq("email", email)
        .eq("tenant_id", tenant_id)
        .execute()
    )
    if existing.data:
        raise HTTPException(status_code=400, detail="Utente con questa email già presente nel tenant")

    # Crea l'utente in Supabase Auth via admin API
    from supabase import Client
    admin_auth = db.auth.admin

    try:
        auth_user = admin_auth.create_user({
            "email": email,
            "email_confirm": False,
            "app_metadata": {
                "tenant_id": tenant_id,
                "ruolo": ruolo,
            },
            "user_metadata": {
                "nome": nome,
            }
        })
        user_id = auth_user.user.id
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Errore creazione utente auth: {str(e)}")

    # Crea il profilo nella tabella user
    avatar_ini = "".join(part[0].upper() for part in nome.split()[:2]) if nome else "?"
    resp = db.table("user").insert({
        "id": str(user_id),
        "tenant_id": tenant_id,
        "nome": nome,
        "email": email,
        "ruolo": ruolo,
        "stato": "invitato",
        "avatar_ini": avatar_ini,
    }).execute()

    return resp.data[0]


@router.patch("/{user_id}", response_model=UserOut)
async def aggiorna_utente(
    user_id: UUID,
    nome: str = None,
    ruolo: str = None,
    stato: str = None,
    current_user: dict = Depends(require_advisor),
):
    """
    Aggiorna un utente del tenant (nome, ruolo, stato).
    Non è possibile cancellare fisicamente un utente (§24).
    """
    tenant_id = tenant_filter(current_user)
    db = get_supabase()

    # Verifica appartenenza al tenant
    existing = (
        db.table("user")
        .select("*")
        .eq("id", str(user_id))
        .eq("tenant_id", tenant_id)
        .single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Utente non trovato nel tenant")

    updates = {}
    if nome is not None:
        updates["nome"] = nome
    if ruolo is not None:
        updates["ruolo"] = ruolo
    if stato is not None:
        if stato not in ("attivo", "disattivato"):
            raise HTTPException(status_code=400, detail="Stato non valido. Valori ammessi: attivo, disattivato")
        updates["stato"] = stato

    if not updates:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")

    resp = (
        db.table("user")
        .update(updates)
        .eq("id", str(user_id))
        .eq("tenant_id", tenant_id)
        .execute()
    )

    return resp.data[0]
