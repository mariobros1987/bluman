from uuid import UUID
from collections import deque
from fastapi import APIRouter, Depends, HTTPException, status
from app.db.auth import get_current_user, require_advisor, tenant_filter
from app.db.client import get_supabase
from app.models.libreria import (
    ModuloTemplateCreate, 
    ModuloTemplateOut, 
    DipendenzaTemplateCreate, 
    DipendenzaTemplateOut
)

router = APIRouter()


def _verifica_anti_ciclo(db, tenant_id: str, modulo_id: str, dipende_da_id: str):
    """
    Verifica anti-ciclo sul grafo dipendenze (§7ter).
    BFS partendo da dipende_da_id: se raggiungiamo modulo_id,
    aggiungere questa dipendenza creerebbe un ciclo.
    """
    # Carica tutte le dipendenze del tenant
    deps_resp = (
        db.table("modulo_dipendenza_template")
        .select("modulo_template_id, dipende_da_modulo_template_id")
        .eq("tenant_id", tenant_id)
        .execute()
    )
    deps = deps_resp.data or []

    # Costruisci grafo: chi dipende da chi (adjacency list "dipende_da → [chi_dipende]")
    # Direzione invertita: da dipende_da_id, seguiamo "chi dipende da questo"
    # per verificare se arriviamo a modulo_id
    graph: dict[str, list[str]] = {}
    for d in deps:
        src = d["dipende_da_modulo_template_id"]
        dst = d["modulo_template_id"]
        graph.setdefault(src, []).append(dst)

    # Aggiungiamo l'arco proposto (modulo_id dipende da dipende_da_id)
    # Tradotto: dal nodo modulo_id, dovremmo verificare se possiamo
    # raggiungere dipende_da_id seguendo gli archi "dipende_da"
    # Ovvero: da dipende_da_id, seguendo "chi dipende da questo" arriviamo a modulo_id?
    # Se sì, aggiungere modulo_id → dipende_da_id creerebbe il ciclo.
    # Ma noi vogliamo verificare che modulo_id non sia un antenato di dipende_da_id.
    # Costruiamo adjacency "X → Y se Y dipende da X" e facciamo BFS da modulo_id
    visited = set()
    queue = deque([modulo_id])
    while queue:
        node = queue.popleft()
        if node in visited:
            continue
        visited.add(node)
        for neighbor in graph.get(node, []):
            if neighbor == dipende_da_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Aggiungere questa dipendenza creerebbe un ciclo nel grafo dei moduli."
                )
            queue.append(neighbor)


@router.get("", response_model=list[ModuloTemplateOut])
async def lista_moduli_template(current_user: dict = Depends(get_current_user)):
    """Lista i template dei moduli, incluse le micro-voci, per il tenant."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    # Filtra per quelli che sono l'ultima versione
    resp = (
        db.table("modulo_template")
        .select("*, microvoce_template(*), dipendenze:modulo_dipendenza_template!modulo_dipendenza_template_modulo_template_id_fkey(dipende_da_modulo_template_id)")
        .eq("tenant_id", tenant_id)
        .eq("is_ultima_versione", True)
        .order("categoria")
        .execute()
    )
    
    # Rinomina la chiave nidificata di supabase da microvoce_template a micro_voci
    result = []
    for row in resp.data or []:
        row["micro_voci"] = row.pop("microvoce_template", [])
        result.append(row)
        
    return result

@router.post("", response_model=ModuloTemplateOut, status_code=status.HTTP_201_CREATED)
async def crea_modulo_template(body: ModuloTemplateCreate, current_user: dict = Depends(require_advisor)):
    """Crea un nuovo template per un modulo con le sue micro-voci."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    mod_resp = db.table("modulo_template").insert({
        "tenant_id": tenant_id,
        "nome": body.nome,
        "categoria": body.categoria,
        "ore_default": body.ore_default,
        "prezzo_default": body.prezzo_default,
        "prezzo_pacchetto": body.prezzo_pacchetto,
        "note": body.note,
    }).execute()
    modulo = mod_resp.data[0]
    
    micro_voci_out = []
    if body.micro_voci:
        mvs_insert = [
            {
                "modulo_template_id": modulo["id"],
                "nome": mv.nome,
                "ordine": mv.ordine,
                "ore_default": mv.ore_default,
                "note": mv.note
            } for mv in body.micro_voci
        ]
        mv_resp = db.table("microvoce_template").insert(mvs_insert).execute()
        micro_voci_out = mv_resp.data

    modulo["micro_voci"] = micro_voci_out
    return modulo

@router.post("/{modulo_id}/dipendenze", response_model=DipendenzaTemplateOut)
async def aggiungi_dipendenza_template(
    modulo_id: UUID, 
    body: DipendenzaTemplateCreate, 
    current_user: dict = Depends(require_advisor)
):
    """Aggiunge una dipendenza al template del modulo (es. Modulo A dipende da Modulo B)."""
    tenant_id = tenant_filter(current_user)
    db = get_supabase()
    
    if str(modulo_id) == str(body.dipende_da_modulo_template_id):
        raise HTTPException(status_code=400, detail="Un modulo non può dipendere da se stesso")
    
    # Verifica anti-ciclo (§7ter)
    _verifica_anti_ciclo(db, tenant_id, str(modulo_id), str(body.dipende_da_modulo_template_id))
        
    try:
        resp = db.table("modulo_dipendenza_template").insert({
            "tenant_id": tenant_id,
            "modulo_template_id": str(modulo_id),
            "dipende_da_modulo_template_id": str(body.dipende_da_modulo_template_id),
        }).execute()
    except Exception as e:
        # Errore tipico di violazione UNIQUE constraint
        raise HTTPException(status_code=400, detail=str(e))
        
    return resp.data[0]

