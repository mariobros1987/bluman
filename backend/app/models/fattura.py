from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID
from datetime import date, datetime

class FatturaRigaCreate(BaseModel):
    tipo: str # modulo_completo | modulo_parziale | milestone_libera
    modulo_progetto_id: Optional[UUID] = None
    percentuale: Optional[float] = None
    importo: float
    descrizione: str
    ordine: int = 0

class FatturaCreate(BaseModel):
    progetto_id: UUID
    cliente_id: UUID
    numero: str
    data_fattura: date
    tipo_cliente_fiscale: str = "b2b"
    partita_iva: Optional[str] = None
    codice_fiscale: Optional[str] = None
    note: Optional[str] = None
    righe: List[FatturaRigaCreate] = []

class FatturaUpdate(BaseModel):
    stato: Optional[str] = None # bozza | emessa | incassata
    note: Optional[str] = None
    tipo_cliente_fiscale: Optional[str] = None
    partita_iva: Optional[str] = None
    codice_fiscale: Optional[str] = None

class FatturaOut(BaseModel):
    id: UUID
    tenant_id: UUID
    progetto_id: UUID
    cliente_id: UUID
    numero: str
    data_fattura: date
    stato: str
    totale: float
    tipo_cliente_fiscale: str
    partita_iva: Optional[str]
    codice_fiscale: Optional[str]
    numero_progressivo: Optional[int]
    canale: str
    stato_sdi: str
    xml_fatturapa_url: Optional[str]
    note: Optional[str]
    righe: List[dict] = []
    created_at: datetime
    updated_at: datetime
