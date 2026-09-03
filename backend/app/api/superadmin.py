from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from typing import Optional
from app.db.auth import require_super_admin
from app.db.client import get_supabase

router = APIRouter()


class TenantCreate(BaseModel):
    ragione_sociale: str
    piano: str = "trial"
    advisor_nome: str
    advisor_email: EmailStr


@router.get("/tenants")
async def lista_tenants(current_user: dict = Depends(require_super_admin)):
    """Restituisce la lista di tutti i tenant (solo Super Admin)."""
    db = get_supabase()
    resp = db.table("tenant").select("*").order("created_at", desc=True).execute()
    return resp.data or []


@router.post("/tenants")
async def crea_tenant(body: TenantCreate, current_user: dict = Depends(require_super_admin)):
    """
    Crea un nuovo tenant e il primo advisor via invito email (§27).
    """
    db = get_supabase()

    # 1. Crea il tenant
    t_resp = db.table("tenant").insert({
        "ragione_sociale": body.ragione_sociale,
        "piano": body.piano,
        "stato": "trial",
    }).execute()
    tenant = t_resp.data[0]
    tenant_id = tenant["id"]

    # 2. Crea l'utente advisor in Supabase Auth
    try:
        admin_auth = db.auth.admin
        auth_user = admin_auth.create_user({
            "email": body.advisor_email,
            "email_confirm": False,
            "app_metadata": {
                "tenant_id": tenant_id,
                "ruolo": "advisor",
            },
            "user_metadata": {
                "nome": body.advisor_nome,
            },
        })
        user_id = auth_user.user.id
    except Exception as e:
        # Rollback tenant
        db.table("tenant").delete().eq("id", tenant_id).execute()
        raise HTTPException(status_code=400, detail=f"Errore creazione advisor: {str(e)}")

    # 3. Crea il profilo nella tabella user
    avatar_ini = "".join(part[0].upper() for part in body.advisor_nome.split()[:2])
    db.table("user").insert({
        "id": str(user_id),
        "tenant_id": tenant_id,
        "nome": body.advisor_nome,
        "email": body.advisor_email,
        "ruolo": "advisor",
        "stato": "invitato",
        "avatar_ini": avatar_ini,
    }).execute()

    return {
        "tenant": tenant,
        "advisor": {"id": str(user_id), "email": body.advisor_email, "stato": "invitato"},
    }


@router.get("/tenants/{tenant_id}/metriche")
async def metriche_tenant(tenant_id: UUID, current_user: dict = Depends(require_super_admin)):
    """Restituisce le metriche aggregate di un tenant (§21)."""
    db = get_supabase()
    tid = str(tenant_id)

    # Verifica che il tenant esista
    t_resp = db.table("tenant").select("*").eq("id", tid).single().execute()
    if not t_resp.data:
        raise HTTPException(status_code=404, detail="Tenant non trovato")

    # Conteggi
    utenti = db.table("user").select("id", count="exact").eq("tenant_id", tid).execute()
    clienti = db.table("cliente").select("id", count="exact").eq("tenant_id", tid).execute()
    progetti = db.table("progetto").select("id", count="exact").eq("tenant_id", tid).execute()
    fatture = db.table("fattura").select("id, totale").eq("tenant_id", tid).execute()

    totale_fatturato = sum(float(f.get("totale", 0)) for f in (fatture.data or []))

    return {
        "tenant": t_resp.data,
        "utenti": utenti.count if hasattr(utenti, 'count') else len(utenti.data or []),
        "clienti": clienti.count if hasattr(clienti, 'count') else len(clienti.data or []),
        "progetti": progetti.count if hasattr(progetti, 'count') else len(progetti.data or []),
        "fatture_emesse": len(fatture.data or []),
        "totale_fatturato": totale_fatturato,
    }


@router.post("/tenants/{tenant_id}/sospendi")
async def sospendi_tenant(tenant_id: UUID, current_user: dict = Depends(require_super_admin)):
    """Sospende l'accesso a un tenant."""
    db = get_supabase()
    resp = (
        db.table("tenant")
        .update({"stato": "sospeso"})
        .eq("id", str(tenant_id))
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Tenant non trovato")
    return resp.data[0]


@router.post("/tenants/{tenant_id}/riattiva")
async def riattiva_tenant(tenant_id: UUID, current_user: dict = Depends(require_super_admin)):
    """Riattiva un tenant sospeso."""
    db = get_supabase()
    resp = (
        db.table("tenant")
        .update({"stato": "attivo"})
        .eq("id", str(tenant_id))
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Tenant non trovato")
    return resp.data[0]


@router.post("/tenants/{tenant_id}/reset-owner-access")
async def reset_owner_access(tenant_id: UUID, current_user: dict = Depends(require_super_admin)):
    """
    Resetta l'accesso dell'owner del tenant (§21).
    Trova il primo advisor e reinvia l'email di invito.
    """
    db = get_supabase()
    tid = str(tenant_id)

    # Trova il primo advisor del tenant
    advisor_resp = (
        db.table("user")
        .select("*")
        .eq("tenant_id", tid)
        .eq("ruolo", "advisor")
        .order("created_at")
        .limit(1)
        .execute()
    )
    if not advisor_resp.data:
        raise HTTPException(status_code=404, detail="Nessun advisor trovato per questo tenant")

    advisor = advisor_resp.data[0]

    # Reinvia invito via Supabase Auth
    try:
        admin_auth = db.auth.admin
        admin_auth.invite_user_by_email(advisor["email"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore reinvio invito: {str(e)}")

    return {"status": "invito_reinviato", "email": advisor["email"]}

