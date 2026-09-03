import os
from dotenv import load_dotenv
load_dotenv()

from supabase import create_client
from jose import jwt, JWTError

url = os.environ["SUPABASE_URL"]
key = os.environ["SUPABASE_SERVICE_KEY"]
db = create_client(url, key)

print("Eseguo login con admin@bluman.com per ottenere token...")
try:
    resp = db.auth.sign_in_with_password({"email": "admin@bluman.com", "password": "Password123!"})
    token = resp.session.access_token
    print(f"Token JWT ottenuto: {token[:20]}...")
    
    secret = os.environ["SUPABASE_JWT_SECRET"]
    
    # Try decoding exactly as in app/db/auth.py
    print("Decodifica in corso...")
    payload = jwt.decode(
        token,
        secret,
        algorithms=["HS256", "HS512", "RS256"],
        options={"verify_aud": False},
    )
    print("Successo! Payload:", payload)
except JWTError as e:
    print(f"ERRORE JWT: {e}")
except Exception as e:
    print(f"Errore: {e}")
