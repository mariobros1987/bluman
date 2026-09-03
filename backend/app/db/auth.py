from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.config import get_settings
from app.db.client import get_supabase

bearer = HTTPBearer()


def decode_token(token: str) -> dict:
    """Verifica e decodifica il JWT emesso da Supabase Auth."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256", "HS512", "RS256"],
            options={"verify_aud": False},
        )
        return payload
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token non valido: {e}",
        )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
) -> dict:
    """
    Dependency che estrae l'utente dal JWT Supabase.
    Restituisce un dict con: user_id, tenant_id, ruolo, is_super_admin.
    """
    token = credentials.credentials
    payload = decode_token(token)

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token privo di sub")

    # I metadati utente (tenant_id, ruolo) sono in app_metadata
    app_meta = payload.get("app_metadata", {})
    user_meta = payload.get("user_metadata", {})

    return {
        "user_id": user_id,
        "email": payload.get("email"),
        "tenant_id": app_meta.get("tenant_id"),          # None se super_admin
        "ruolo": app_meta.get("ruolo", "collaboratore_interno"),
        "is_super_admin": app_meta.get("is_super_admin", False),
    }


async def require_advisor(current_user: dict = Depends(get_current_user)) -> dict:
    """Solo advisor o super_admin possono accedere."""
    if current_user["ruolo"] not in ("advisor", ) and not current_user["is_super_admin"]:
        raise HTTPException(status_code=403, detail="Accesso riservato agli advisor")
    return current_user


async def require_super_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """Solo super_admin."""
    if not current_user["is_super_admin"]:
        raise HTTPException(status_code=403, detail="Accesso riservato al Super Admin")
    return current_user


def tenant_filter(current_user: dict) -> str:
    """
    Restituisce il tenant_id dell'utente corrente.
    Solleva eccezione se non è un utente di tenant (es. super_admin che chiama API sbagliata).
    """
    tid = current_user.get("tenant_id")
    if not tid:
        raise HTTPException(
            status_code=403,
            detail="Questa API richiede un utente appartenente a un tenant.",
        )
    return tid
