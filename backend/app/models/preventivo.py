"""
Modelli Pydantic per Preventivo, Progetto, e relative operazioni.
"""
from __future__ import annotations
from datetime import datetime, date
from decimal import Decimal
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field, EmailStr


# ── Righe Preventivo ──────────────────────────────────────────

class RigaPreventivo(BaseModel):
    modulo_template_id: UUID
    modulo_template_versione: int
    nome: str
    categoria: str
    ore: Decimal
    prezzo_proposto: Decimal


# ── Preventivo ────────────────────────────────────────────────

class PreventivoCreate(BaseModel):
    cliente_id: UUID
    titolo: Optional[str] = None
    note: Optional[str] = None
    righe: list[RigaPreventivo] = Field(default_factory=list)


class PreventivoUpdate(BaseModel):
    titolo: Optional[str] = None
    note: Optional[str] = None
    righe: Optional[list[RigaPreventivo]] = None


class PreventivoOut(BaseModel):
    id: UUID
    tenant_id: UUID
    cliente_id: UUID
    creato_da: UUID
    stato: str
    titolo: Optional[str]
    note: Optional[str]
    valore_totale: Decimal
    righe: list[dict]
    inviato_at: Optional[datetime]
    accettato_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Progetto ──────────────────────────────────────────────────

class ProgettoOut(BaseModel):
    id: UUID
    tenant_id: UUID
    cliente_id: UUID
    preventivo_id: Optional[UUID]
    nome: str
    stato: str
    data_inizio: Optional[date]
    data_scadenza: Optional[date]
    valore_totale: Decimal
    note: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProgettoUpdate(BaseModel):
    nome: Optional[str] = None
    stato: Optional[str] = None
    data_inizio: Optional[date] = None
    data_scadenza: Optional[date] = None
    note: Optional[str] = None


# ── Engagement Letter ─────────────────────────────────────────

class EngagementLetterOut(BaseModel):
    id: UUID
    tenant_id: UUID
    preventivo_id: UUID
    progetto_id: Optional[UUID]
    stato_firma: str
    docusign_envelope_id: Optional[str]
    docusign_signing_url: Optional[str]
    pdf_url: Optional[str]
    inviata_at: Optional[datetime]
    firmata_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Risposta accettazione preventivo ─────────────────────────

class AccettazioneResult(BaseModel):
    preventivo: PreventivoOut
    progetto: ProgettoOut
    engagement_letter: EngagementLetterOut
    messaggio: str = "Preventivo accettato. Progetto creato e engagement letter inviata per firma."
