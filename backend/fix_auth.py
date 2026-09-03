import os, sys
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv()

from supabase import create_client
url = os.environ["SUPABASE_URL"]
key = os.environ["SUPABASE_SERVICE_KEY"]
db = create_client(url, key)

print("Impostazione app_metadata per l'utente admin...")

user_id = "af8e680d-4e5d-4505-9fcd-cdfad0b1f7b0"
tenant_id = "cf9e37e3-8eab-460b-a368-4f02c02f2e7f"

# Aggiorna l'utente in auth.users
try:
    resp = db.auth.admin.update_user_by_id(
        user_id,
        {"app_metadata": {"tenant_id": tenant_id, "ruolo": "advisor", "is_super_admin": False}}
    )
    print("Fatto. I nuovi metadati sono:")
    print(getattr(resp.user, 'app_metadata', {}))
except Exception as e:
    print(f"Errore durante l'aggiornamento: {e}")
