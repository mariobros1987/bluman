from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime

class MicrovoceTemplateCreate(BaseModel):
    nome: str
    ordine: int
    ore_default: float = 0
    note: Optional[str] = None

class ModuloTemplateCreate(BaseModel):
    nome: str
    categoria: str
    ore_default: float = 0
    prezzo_default: float = 0
    prezzo_pacchetto: Optional[float] = None
    note: Optional[str] = None
    micro_voci: list[MicrovoceTemplateCreate] = []

class ModuloTemplateOut(BaseModel):
    id: UUID
    tenant_id: UUID
    nome: str
    categoria: str
    versione: int
    is_ultima_versione: bool
    ore_default: float
    prezzo_default: float
    prezzo_pacchetto: Optional[float]
    note: Optional[str]
    micro_voci: list[dict] = []
    created_at: datetime
    updated_at: datetime

class DipendenzaTemplateCreate(BaseModel):
    dipende_da_modulo_template_id: UUID

class DipendenzaTemplateOut(BaseModel):
    id: UUID
    tenant_id: UUID
    modulo_template_id: UUID
    dipende_da_modulo_template_id: UUID
    created_at: datetime
