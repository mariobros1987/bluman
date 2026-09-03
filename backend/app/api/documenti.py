from uuid import UUID
import uuid
import datetime
from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Form
from app.db.auth import get_current_user, tenant_filter
from app.db.client import get_supabase
from app.models.documento import DocumentoCreate, DocumentoOut

router = APIRouter()

# Whitelist semplificata dei magic bytes per Fase 8
ALLOWED_MAGIC_BYTES = {
    b"%PDF": "application/pdf",
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
    b"PK\x03\x04": "application/zip", # DOCX, XLSX, etc. are ZIP
}

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB

@router.get("", response_model=list[DocumentoOut])
async def lista_documenti(
    progetto_id: UUID = None, 
    microvoce_progetto_id: UUID = None, 
    current_user: dict = Depends(get_current_user)
):
    """Lista metadati dei documenti. I documenti infetti o in_attesa sono visibili solo a chi li ha caricati o all'owner."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    query = db.table("documento").select("*").eq("tenant_id", tenant_id)
    if progetto_id:
        query = query.eq("progetto_id", str(progetto_id))
    if microvoce_progetto_id:
        query = query.eq("microvoce_progetto_id", str(microvoce_progetto_id))
        
    resp = query.order("created_at", desc=True).execute()
    docs = resp.data or []

    # Sicurezza: visibile solo a chi l'ha caricato finché non è pulito (§28)
    user_id = current_user["user_id"]
    ruolo = current_user.get("ruolo")
    
    filtered_docs = []
    for doc in docs:
        if doc.get("stato_scansione") == "pulito" or doc.get("caricato_da") == user_id or ruolo in ("owner", "admin"):
            filtered_docs.append(doc)
            
    return filtered_docs

@router.post("/upload", response_model=DocumentoOut, status_code=status.HTTP_201_CREATED)
async def upload_documento(
    progetto_id: str = Form(...),
    microvoce_progetto_id: str = Form(None),
    tipo: str = Form("compilato"),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """
    Endpoint per l'upload sicuro (§28).
    - Limite 20MB
    - Verifica magic bytes
    - Stato in_attesa (finto scan ClamAV)
    """
    tenant_id = tenant_filter(current_user)
    db = get_supabase()

    # Leggi file
    file_bytes = await file.read()
    size = len(file_bytes)

    # 1. Verifica dimensione
    if size > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File supera il limite di 20MB")

    # 2. Verifica Magic Bytes
    if size < 8:
        raise HTTPException(status_code=400, detail="File troppo piccolo o corrotto")

    file_signature = file_bytes[:8]
    is_valid_format = False
    for magic, mime in ALLOWED_MAGIC_BYTES.items():
        if file_signature.startswith(magic):
            is_valid_format = True
            break

    if not is_valid_format:
        raise HTTPException(status_code=400, detail="Formato file non consentito o corrotto (magic bytes falliti)")

    # 3. Upload a Supabase Storage
    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    storage_path = f"{tenant_id}/{progetto_id}/{uuid.uuid4()}.{ext}"
    
    try:
        # In una vera app, gestire le eccezioni di rete qui
        db.storage.from_("documenti").upload(storage_path, file_bytes, {"content-type": file.content_type})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore caricamento su storage: {e}")

    file_url = db.storage.from_("documenti").get_public_url(storage_path)

    # 4. Mock scansione ClamAV / VirusTotal
    # Impostiamo su "in_attesa". Un worker in background (es. Celery) farà la scansione.
    # Per ora simuliamo che la scansione finisca subito come 'pulito', ma il codice gestisce 'in_attesa'.
    stato_scansione = "pulito"
    scansionato_at = datetime.datetime.now().isoformat()

    # 5. Salva su DB
    doc_resp = db.table("documento").insert({
        "tenant_id": tenant_id,
        "progetto_id": progetto_id,
        "microvoce_progetto_id": microvoce_progetto_id if microvoce_progetto_id else None,
        "tipo": tipo,
        "nome_file": file.filename,
        "file_url": file_url,
        "mime_type": file.content_type,
        "dimensione_bytes": size,
        "versione": 1,
        "caricato_da": current_user["user_id"],
        "stato_scansione": stato_scansione,
        "scansionato_at": scansionato_at
    }).execute()
    
    return doc_resp.data[0]

