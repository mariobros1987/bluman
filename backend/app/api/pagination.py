from pydantic import BaseModel
from typing import Generic, TypeVar, List
from fastapi import Query

T = TypeVar("T")

class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    limit: int
    total_pages: int

def get_pagination_params(
    page: int = Query(1, ge=1, description="Numero pagina"),
    limit: int = Query(25, ge=1, le=100, description="Elementi per pagina"),
    q: str = Query(None, description="Termine di ricerca")
):
    return {"page": page, "limit": limit, "q": q}

def apply_pagination(query, page: int, limit: int):
    """Applica range (limit, offset) a una query Supabase postgrest."""
    start = (page - 1) * limit
    end = start + limit - 1
    return query.range(start, end)
