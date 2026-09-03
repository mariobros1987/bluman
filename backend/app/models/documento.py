from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime

class DocumentoCreate(BaseModel):
    progetto_id: UUID
    microvoce_progetto_id: Optional[UUID] = None
    tipo: str = "compilato" # template_vuoto | compilato | firmato
    nome_file: str
    file_url: str
    mime_type: Optional[str] = None
    dimensione_bytes: Optional[int] = None
    versione: int = 1

class DocumentoOut(BaseModel):
    id: UUID
    tenant_id: UUID
    progetto_id: UUID
    microvoce_progetto_id: Optional[UUID]
    tipo: str
    nome_file: str
    file_url: str
    mime_type: Optional[str]
    dimensione_bytes: Optional[int]
    versione: int
    stato_scansione: str
    scansionato_at: Optional[datetime]
    caricato_da: Optional[UUID]
    created_at: datetime
