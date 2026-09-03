from pydantic import BaseModel
from typing import Optional, List, Any
from uuid import UUID
from datetime import datetime

class PassaggioProgettoCreate(BaseModel):
    titolo: str
    tipo: str  # info | documento | form | verifica
    chi: str = "operatore"  # operatore | cliente
    descrizione: Optional[str] = None
    campi_form_json: Optional[List[Any]] = []

class PassaggioProgettoUpdate(BaseModel):
    titolo: Optional[str] = None
    descrizione: Optional[str] = None
    stato: Optional[str] = None  # pending | done
    documento_id: Optional[UUID] = None
    risposte_form_json: Optional[dict] = None
    ordine: Optional[int] = None

class PassaggioProgettoOut(BaseModel):
    id: UUID
    tenant_id: UUID
    microvoce_progetto_id: UUID
    titolo: str
    tipo: str
    chi: str
    ordine: int
    descrizione: Optional[str]
    campi_form_json: Optional[List[Any]]
    stato: str
    documento_id: Optional[UUID]
    risposte_form_json: Optional[dict]
    created_at: datetime
    updated_at: datetime
