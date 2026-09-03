from postmarker.core import PostmarkClient
from app.config import get_settings

def get_postmark_client():
    settings = get_settings()
    if not settings.POSTMARK_TOKEN:
        return None
    return PostmarkClient(server_token=settings.POSTMARK_TOKEN)

async def invia_notifica_email(to_email: str, subject: str, html_body: str):
    """Invia un'email transazionale tramite Postmark."""
    client = get_postmark_client()
    if not client:
        print(f"[Email - DEV] Invio simulato a {to_email} | Oggetto: '{subject}'")
        return
        
    settings = get_settings()
    try:
        client.emails.send(
            From=f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM}>",
            To=to_email,
            Subject=subject,
            HtmlBody=html_body
        )
    except Exception as e:
        print(f"[Postmark] Errore invio email a {to_email}: {e}")
