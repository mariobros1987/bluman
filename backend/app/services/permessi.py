from uuid import UUID
from fastapi import HTTPException
from app.db.client import get_supabase

async def check_scope(
    db, 
    tenant_id: str, 
    user_id: str, 
    ruolo: str, 
    tipo_risorsa: str, 
    risorsa_id: str, 
    livello_richiesto: str = "lettura"
) -> bool:
    """
    Verifica i permessi granulari su una specifica risorsa (§19).
    Restituisce True se permesso, solleva HTTPException 403 se negato.

    Regole:
    - super_admin bypassa tutto.
    - owner e admin del tenant bypassano il controllo granulare per le risorse del proprio tenant.
    - per gli altri ruoli (advisor, collaboratore), si verifica la tabella accesso_risorsa.
    - I permessi vengono ereditati verso il basso:
        Se hai accesso al progetto, hai accesso ai suoi moduli e documenti.
        Se hai accesso al modulo, hai accesso alle sue microvoci.
    """
    if ruolo == "super_admin":
        return True
        
    if ruolo in ("owner", "admin"):
        # L'RSL (lato Supabase) o il tenant_filter garantiscono già 
        # l'isolamento tra tenant. L'admin vede tutto nel suo tenant.
        return True

    # 1. Controllo diretto sulla risorsa
    resp = (
        db.table("accesso_risorsa")
        .select("livello")
        .eq("tenant_id", tenant_id)
        .eq("user_id", user_id)
        .eq("tipo_risorsa", tipo_risorsa)
        .eq("risorsa_id", risorsa_id)
        .execute()
    )
    if resp.data:
        livello_assegnato = resp.data[0]["livello"]
        if livello_richiesto == "lettura" or livello_assegnato == "scrittura":
            return True

    # 2. Controllo ereditato (verso l'alto)
    if tipo_risorsa == "modulo_progetto":
        # Se ha accesso al progetto padre, ha accesso al modulo
        mod_resp = db.table("modulo_progetto").select("progetto_id").eq("id", risorsa_id).single().execute()
        if mod_resp.data:
            prog_id = mod_resp.data["progetto_id"]
            prog_resp = (
                db.table("accesso_risorsa")
                .select("livello")
                .eq("tenant_id", tenant_id)
                .eq("user_id", user_id)
                .eq("tipo_risorsa", "progetto")
                .eq("risorsa_id", str(prog_id))
                .execute()
            )
            if prog_resp.data:
                livello_assegnato = prog_resp.data[0]["livello"]
                if livello_richiesto == "lettura" or livello_assegnato == "scrittura":
                    return True

    elif tipo_risorsa == "documento":
        # Se ha accesso al progetto, ha accesso al documento
        doc_resp = db.table("documento").select("progetto_id").eq("id", risorsa_id).single().execute()
        if doc_resp.data:
            prog_id = doc_resp.data["progetto_id"]
            prog_resp = (
                db.table("accesso_risorsa")
                .select("livello")
                .eq("tenant_id", tenant_id)
                .eq("user_id", user_id)
                .eq("tipo_risorsa", "progetto")
                .eq("risorsa_id", str(prog_id))
                .execute()
            )
            if prog_resp.data:
                livello_assegnato = prog_resp.data[0]["livello"]
                if livello_richiesto == "lettura" or livello_assegnato == "scrittura":
                    return True

    raise HTTPException(
        status_code=403, 
        detail=f"Accesso negato alla risorsa ({tipo_risorsa} - {risorsa_id}) per livello {livello_richiesto}"
    )
