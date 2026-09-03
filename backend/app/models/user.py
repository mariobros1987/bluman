from pydantic import BaseModel, EmailStr
from typing import Optional
from uuid import UUID
from datetime import datetime

class UserOut(BaseModel):
    id: UUID
    tenant_id: Optional[UUID]
    nome: str
    email: EmailStr
    ruolo: str
    stato: str
    colore: Optional[str]
    avatar_ini: Optional[str]
    created_at: datetime
    updated_at: datetime
