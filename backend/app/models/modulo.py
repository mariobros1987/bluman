from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime

class ModuloProgettoUpdate(BaseModel):
    stato: Optional[str] = None
    avanzamento_pct: Optional[float] = None
    importo_fatturato: Optional[float] = None

class ModuloProgettoOut(BaseModel):
    id: UUID
    tenant_id: UUID
    progetto_id: UUID
    modulo_template_id: Optional[UUID]
    modulo_template_versione: Optional[int]
    nome: str
    categoria: str
    prezzo: float
    stato: str
    ore_preventivate: float
    ore_consuntivate: float
    avanzamento_pct: float
    importo_fatturato: float
    ordine: int
    created_at: datetime
    updated_at: datetime
