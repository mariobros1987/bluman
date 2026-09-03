"""
Integrazione DocuSign per l'invio dell'engagement letter.
Usa python-docusign-esign con autenticazione JWT (RSA key pair).
"""
from __future__ import annotations
import base64
from typing import Optional
from app.config import get_settings


async def invia_engagement_letter_docusign(
    engagement_letter_id: str,
    tenant_id: str,
    preventivo: dict,
    progetto: dict,
) -> Optional[dict]:
    """
    Crea un envelope DocuSign con l'engagement letter e lo invia al cliente.
    Restituisce dict con envelope_id e signing_url, oppure None se DocuSign non è configurato.
    """
    settings = get_settings()

    # Se le credenziali DocuSign non sono configurate, ritorna None (sviluppo locale)
    if not settings.DOCUSIGN_INTEGRATION_KEY or not settings.DOCUSIGN_USER_ID:
        print("[DocuSign] Credenziali non configurate — skip invio engagement letter")
        return None

    try:
        import docusign_esign as ds
    except ImportError:
        print("[DocuSign] python-docusign-esign non installato")
        return None

    # Autentica via JWT
    api_client = _get_api_client(settings)

    # Genera il PDF dell'engagement letter (placeholder — da implementare con libreria PDF)
    pdf_content = _genera_pdf_engagement_letter(preventivo, progetto)

    # Crea l'envelope
    envelope_api = ds.EnvelopesApi(api_client)

    # Documento
    documento = ds.Document(
        document_base64=base64.b64encode(pdf_content).decode("ascii"),
        name="Engagement Letter",
        file_extension="pdf",
        document_id="1",
    )

    # Firmatario (il cliente)
    # In produzione: caricare email/nome cliente dal DB
    cliente_email = preventivo.get("cliente_email", "cliente@example.com")
    cliente_nome = preventivo.get("cliente_nome", "Cliente")

    firmatario = ds.Signer(
        email=cliente_email,
        name=cliente_nome,
        recipient_id="1",
        routing_order="1",
        tabs=ds.Tabs(
            sign_here_tabs=[
                ds.SignHere(
                    anchor_string="/firma/",
                    anchor_y_offset="10",
                    anchor_units="pixels",
                )
            ]
        ),
    )

    envelope_def = ds.EnvelopeDefinition(
        email_subject="Engagement Letter — Bluecode Advisory",
        documents=[documento],
        recipients=ds.Recipients(signers=[firmatario]),
        status="sent",
    )

    result = envelope_api.create_envelope(
        account_id=settings.DOCUSIGN_ACCOUNT_ID,
        envelope_definition=envelope_def,
    )

    envelope_id = result.envelope_id

    # Genera URL firma embedded (per il portale cliente)
    view_request = ds.RecipientViewRequest(
        authentication_method="none",
        client_user_id="1",
        recipient_id="1",
        return_url=f"https://app.blucode.com/portale/firma-completata",
        user_name=cliente_nome,
        email=cliente_email,
    )

    view_result = envelope_api.create_recipient_view(
        account_id=settings.DOCUSIGN_ACCOUNT_ID,
        envelope_id=envelope_id,
        recipient_view_request=view_request,
    )

    return {
        "envelope_id": envelope_id,
        "signing_url": view_result.url,
    }


def _get_api_client(settings) -> object:
    """Configura il client DocuSign con autenticazione JWT RSA."""
    import docusign_esign as ds

    api_client = ds.ApiClient()
    api_client.set_base_path(settings.DOCUSIGN_BASE_URL)

    # Leggi private key da file
    try:
        with open(settings.DOCUSIGN_PRIVATE_KEY_PATH, "rb") as f:
            private_key = f.read()
    except FileNotFoundError:
        raise RuntimeError(
            f"DocuSign private key non trovata: {settings.DOCUSIGN_PRIVATE_KEY_PATH}"
        )

    # Richiedi token JWT
    token_response = api_client.request_jwt_user_token(
        client_id=settings.DOCUSIGN_INTEGRATION_KEY,
        user_id=settings.DOCUSIGN_USER_ID,
        oauth_host_name="account-d.docusign.com",  # demo; prod: account.docusign.com
        private_key_bytes=private_key,
        expires_in=3600,
        scopes=["signature", "impersonation"],
    )

    api_client.set_default_header(
        "Authorization", f"Bearer {token_response.access_token}"
    )
    return api_client


def _genera_pdf_engagement_letter(preventivo: dict, progetto: dict) -> bytes:
    """
    Genera il PDF dell'engagement letter.
    TODO: usare reportlab o weasyprint per un PDF professionale.
    Per ora genera un PDF minimale placeholder.
    """
    # Placeholder: PDF minimale valido
    # In produzione usare: from reportlab.pdfgen import canvas
    contenuto = f"""
ENGAGEMENT LETTER

Studio: Bluecode Ltd
Cliente: {preventivo.get('cliente_id', 'N/A')}
Progetto: {progetto.get('nome', 'N/A')}
Valore totale: EUR {preventivo.get('valore_totale', 0):,.2f}

Servizi inclusi:
""".encode("utf-8")

    righe = preventivo.get("righe", [])
    for riga in righe:
        linea = f"- {riga.get('nome', '')} — EUR {riga.get('prezzo_proposto', 0):,.2f}\n"
        contenuto += linea.encode("utf-8")

    contenuto += b"\n\nFirma del cliente: /firma/\n"
    return contenuto
