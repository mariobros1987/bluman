import os
import requests
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_ANON_KEY")
supabase: Client = create_client(url, key)

res = supabase.auth.sign_in_with_password({"email": "admin@bluman.com", "password": "Password123!"})
token = res.session.access_token

from jose import jwt as jose_jwt
print("Header:", jose_jwt.get_unverified_header(token))

headers = {"Authorization": f"Bearer {token}"}
resp = requests.get("http://localhost:8000/api/auth/me", headers=headers)
print("Status:", resp.status_code)
print("Body:", resp.text)
print("Body:", resp.text)
