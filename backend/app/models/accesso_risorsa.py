from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime

class AccessoRisorsaCreate(BaseModel):
    user_id: UUID
    tipo_risorsa: str
    risorsa_id: UUID
    livello: str = "lettura"

class AccessoRisorsaUpdate(BaseModel):
    livello: str

class AccessoRisorsaOut(BaseModel):
    id: UUID
    tenant_id: UUID
    user_id: UUID
    tipo_risorsa: str
    risorsa_id: UUID
    livello: str
    created_at: datetime
