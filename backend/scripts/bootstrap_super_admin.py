"""
Script CLI per il bootstrap del sistema BluMan (§27).
Crea il primo super_admin con password temporanea.

Uso:
    python -m scripts.bootstrap_super_admin

IMPORTANTE: eseguire UNA SOLA VOLTA. Non è un endpoint pubblico.
"""
import asyncio
import os
import sys
import secrets

# Aggiungi il path del backend per importare i moduli
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import get_settings
from app.db.client import get_supabase


def main():
    settings = get_settings()
    db = get_supabase()

    email = input("Email per il super_admin: ").strip()
    if not email:
        print("Email richiesta.")
        return

    nome = input("Nome completo: ").strip() or "Super Admin"

    # Genera password temporanea
    temp_password = secrets.token_urlsafe(16)

    print(f"\nCreazione super_admin: {email}")
    print(f"Password temporanea: {temp_password}")
    print("(Annotala subito — non verrà mostrata di nuovo)\n")

    try:
        admin_auth = db.auth.admin

        # Crea utente in Supabase Auth con ruolo super_admin
        auth_user = admin_auth.create_user({
            "email": email,
            "password": temp_password,
            "email_confirm": True,
            "app_metadata": {
                "is_super_admin": True,
                "ruolo": "super_admin",
            },
            "user_metadata": {
                "nome": nome,
            },
        })
        user_id = auth_user.user.id
        print(f"✅ Utente auth creato: {user_id}")

        # Crea il profilo nella tabella user (tenant_id = NULL per super_admin)
        db.table("user").insert({
            "id": str(user_id),
            "tenant_id": None,
            "nome": nome,
            "email": email,
            "ruolo": "super_admin",
            "stato": "attivo",
            "avatar_ini": "SA",
        }).execute()
        print(f"✅ Profilo utente creato nella tabella 'user'")

        print(f"\n{'='*50}")
        print(f"BOOTSTRAP COMPLETATO")
        print(f"{'='*50}")
        print(f"Email:    {email}")
        print(f"Password: {temp_password}")
        print(f"")
        print(f"Al primo login:")
        print(f"  1. Cambiare la password")
        print(f"  2. Attivare il 2FA TOTP")
        print(f"{'='*50}")

    except Exception as e:
        print(f"❌ Errore: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
