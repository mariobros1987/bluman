from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime

class MicrovoceUpdate(BaseModel):
    stato: Optional[str] = None
    ore_consuntivate_increment: Optional[float] = None
    causa_nota: Optional[str] = None
    risorsa_id: Optional[UUID] = None
    segnale_rischio: Optional[bool] = None

class MicrovoceOut(BaseModel):
    id: UUID
    tenant_id: UUID
    modulo_progetto_id: UUID
    nome: str
    ordine: int
    ore_preventivate: float
    ore_consuntivate: float
    ore_extra: float
    stato: str
    causa_nota: Optional[str]
    risorsa_id: Optional[UUID]
    segnale_rischio: bool
    created_at: datetime
    updated_at: datetime
