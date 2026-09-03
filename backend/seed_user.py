import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_SERVICE_KEY")
supabase: Client = create_client(url, key)

email = "admin@bluman.com"

try:
    # Trova l'utente in auth.users
    users_resp = supabase.auth.admin.list_users()
    user_id = None
    for u in users_resp:
        if u.email == email:
            user_id = u.id
            break

    if not user_id:
        print(f"Utente {email} non trovato in auth.users")
        exit(1)

    print(f"Trovato utente: {user_id}")

    # Crea un tenant
    tenant_resp = supabase.table("tenant").insert({
        "ragione_sociale": "Bluecode Ltd",
        "piano": "pro",
        "stato": "attivo"
    }).execute()
    tenant_id = tenant_resp.data[0]["id"]
    print(f"Creato tenant: {tenant_id}")

    # Crea il profilo utente
    supabase.table("user").insert({
        "id": user_id,
        "tenant_id": tenant_id,
        "nome": "Admin",
        "email": email,
        "ruolo": "advisor",
        "colore": "#6366f1",
        "avatar_ini": "A"
    }).execute()
    print("Profilo utente creato con successo.")

except Exception as e:
    print(f"Errore: {e}")
