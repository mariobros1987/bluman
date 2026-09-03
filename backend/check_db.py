"""Script per verificare lo stato del database BluMan via Supabase."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv()

from supabase import create_client
url = os.environ["SUPABASE_URL"]
key = os.environ["SUPABASE_SERVICE_KEY"]
db = create_client(url, key)

print("=" * 60)
print("VERIFICA DATABASE BLUMAN")
print("=" * 60)

# 1. Tenant
print("\n--- TENANT ---")
tenants = db.table("tenant").select("*").execute()
for t in tenants.data or []:
    print(f"  ID: {t['id']} | Nome: {t.get('nome')} | Dominio: {t.get('dominio')}")
if not tenants.data:
    print("  (nessun tenant)")

# 2. Users (dalla tabella custom 'user')
print("\n--- UTENTI (tabella user) ---")
users = db.table("user").select("*").execute()
for u in users.data or []:
    print(f"  ID: {u['id']} | Email: {u.get('email')} | Ruolo: {u.get('ruolo')} | Tenant: {u.get('tenant_id')}")
if not users.data:
    print("  (nessun utente nella tabella user)")

# 3. Auth users (tramite admin API)
print("\n--- AUTH USERS (Supabase Auth) ---")
try:
    auth_users = db.auth.admin.list_users()
    for au in auth_users:
        if hasattr(au, 'email'):
            meta = getattr(au, 'app_metadata', {}) or {}
            print(f"  Email: {au.email} | ID: {au.id} | app_metadata: {meta}")
except Exception as e:
    print(f"  Errore nel listare auth users: {e}")

# 4. Clienti
print("\n--- CLIENTI ---")
clienti = db.table("cliente").select("*").execute()
for c in clienti.data or []:
    print(f"  ID: {c['id']} | Nome: {c.get('nome')} | Tipo: {c.get('tipo')} | Tenant: {c.get('tenant_id')}")
if not clienti.data:
    print("  (nessun cliente)")

# 5. Moduli Template
print("\n--- MODULI TEMPLATE ---")
moduli = db.table("modulo_template").select("id, nome, categoria, tenant_id").execute()
for m in moduli.data or []:
    print(f"  ID: {m['id']} | Nome: {m.get('nome')} | Cat: {m.get('categoria')} | Tenant: {m.get('tenant_id')}")
if not moduli.data:
    print("  (nessun modulo template)")

# 6. Preventivi
print("\n--- PREVENTIVI ---")
prev = db.table("preventivo").select("id, titolo, stato, cliente_id, tenant_id").execute()
for p in prev.data or []:
    print(f"  ID: {p['id']} | Titolo: {p.get('titolo')} | Stato: {p.get('stato')} | Cliente: {p.get('cliente_id')} | Tenant: {p.get('tenant_id')}")
if not prev.data:
    print("  (nessun preventivo)")

# 7. Progetti
print("\n--- PROGETTI ---")
proj = db.table("progetto").select("id, nome, stato, preventivo_id, tenant_id").execute()
for p in proj.data or []:
    print(f"  ID: {p['id']} | Nome: {p.get('nome')} | Stato: {p.get('stato')} | Preventivo: {p.get('preventivo_id')} | Tenant: {p.get('tenant_id')}")
if not proj.data:
    print("  (nessun progetto)")

print("\n" + "=" * 60)
print("FINE VERIFICA")
