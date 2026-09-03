import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_SERVICE_KEY")
supabase: Client = create_client(url, key)

email = "admin@bluman.com"
password = "Password123!"

try:
    user = supabase.auth.admin.create_user({
        "email": email,
        "password": password,
        "email_confirm": True,
        "user_metadata": {
            "nome": "Admin",
            "ruolo": "advisor",
            "colore": "#6366f1",
            "avatar_ini": "A"
        }
    })
    print(f"Utente creato con successo!")
    print(f"Email: {email}")
    print(f"Password: {password}")
except Exception as e:
    print(f"Errore: {e}")
