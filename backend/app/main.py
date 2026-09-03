from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings

settings = get_settings()

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Router ────────────────────────────────────────────────────
from app.api import (
    auth,
    clienti,
    preventivi,
    progetti,
    moduli,
    micro_voci,
    passaggi,
    fatture,
    documenti,
    libreria,
    superadmin,
    calendario,
    utenti_tenant,
)

app.include_router(auth.router,           prefix="/api/auth",           tags=["Auth"])
app.include_router(clienti.router,        prefix="/api/clienti",        tags=["Clienti"])
app.include_router(preventivi.router,     prefix="/api/preventivi",     tags=["Preventivi"])
app.include_router(progetti.router,       prefix="/api/progetti",       tags=["Progetti"])
app.include_router(moduli.router,         prefix="/api/moduli",         tags=["Moduli"])
app.include_router(micro_voci.router,     prefix="/api/micro-voci",     tags=["Micro-voci"])
app.include_router(passaggi.router,       prefix="/api/passaggi",       tags=["Passaggi Micro-voci"])
app.include_router(fatture.router,        prefix="/api/fatture",        tags=["Fatture"])
app.include_router(documenti.router,      prefix="/api/documenti",      tags=["Documenti"])
app.include_router(libreria.router,       prefix="/api/libreria",       tags=["Libreria Moduli"])
app.include_router(calendario.router,     prefix="/api/eventi",         tags=["Calendario"])
app.include_router(utenti_tenant.router,  prefix="/api/tenant/utenti",  tags=["Utenti Tenant"])
app.include_router(superadmin.router,     prefix="/api/admin",          tags=["Super Admin"])


@app.get("/health")
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}
