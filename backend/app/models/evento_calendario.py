from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime


class EventoCalendarioCreate(BaseModel):
    progetto_id: Optional[UUID] = None
    titolo: str
    descrizione: Optional[str] = None
    data_inizio: datetime
    data_fine: Optional[datetime] = None
    tutto_giorno: bool = False


class EventoCalendarioUpdate(BaseModel):
    progetto_id: Optional[UUID] = None
    titolo: Optional[str] = None
    descrizione: Optional[str] = None
    data_inizio: Optional[datetime] = None
    data_fine: Optional[datetime] = None
    tutto_giorno: Optional[bool] = None


class EventoCalendarioOut(BaseModel):
    id: UUID
    tenant_id: UUID
    user_id: UUID
    progetto_id: Optional[UUID]
    titolo: str
    descrizione: Optional[str]
    data_inizio: datetime
    data_fine: Optional[datetime]
    tutto_giorno: bool
    created_at: datetime
