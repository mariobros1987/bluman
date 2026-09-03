from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # App
    APP_NAME: str = "BluMan API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # Supabase
    SUPABASE_URL: str
    SUPABASE_SERVICE_KEY: str          # service_role key — usato solo lato server
    SUPABASE_ANON_KEY: str

    # JWT (Supabase emette JWT firmati con questo secret)
    SUPABASE_JWT_SECRET: str

    # DocuSign
    DOCUSIGN_INTEGRATION_KEY: str = ""
    DOCUSIGN_USER_ID: str = ""
    DOCUSIGN_ACCOUNT_ID: str = ""
    DOCUSIGN_PRIVATE_KEY_PATH: str = "docusign_private.key"
    DOCUSIGN_BASE_URL: str = "https://demo.docusign.net/restapi"  # prod: https://na4.docusign.net/restapi

    # Email
    POSTMARK_TOKEN: str = ""
    EMAIL_FROM: str = "noreply@blucode.com"
    EMAIL_FROM_NAME: str = "Bluecode Advisory"

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "https://app.blucode.com"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
