from supabase import create_client, Client
from app.config import get_settings

_client: Client | None = None


def get_supabase() -> Client:
    """Restituisce il client Supabase con service_role key (bypassa RLS).
    Usato esclusivamente lato server — mai esposto al frontend.
    """
    global _client
    if _client is None:
        s = get_settings()
        _client = create_client(s.SUPABASE_URL, s.SUPABASE_SERVICE_KEY)
    return _client
