from pydantic import BaseModel, EmailStr
from typing import Optional, List
from uuid import UUID
from datetime import datetime

class Referente(BaseModel):
    nome: str
    email: Optional[EmailStr] = None
    ruolo: Optional[str] = None

class ClienteCreate(BaseModel):
    nome: str
    tipo: str = "individual" # individual | company
    email: Optional[EmailStr] = None
    telefono: Optional[str] = None
    note: Optional[str] = None
    referenti: List[Referente] = []

class ClienteUpdate(BaseModel):
    nome: Optional[str] = None
    tipo: Optional[str] = None
    email: Optional[EmailStr] = None
    telefono: Optional[str] = None
    note: Optional[str] = None
    referenti: Optional[List[Referente]] = None

class ClienteOut(BaseModel):
    id: UUID
    tenant_id: UUID
    nome: str
    tipo: str
    email: Optional[str]
    telefono: Optional[str]
    note: Optional[str]
    referenti: List[dict]
    created_at: datetime
    updated_at: datetime
