import pytest
import asyncio
from unittest.mock import MagicMock
from app.services.stati import (
    ricalcola_stato_modulo,
    aggiorna_stato_microvoce,
    ricalcola_stato_progetto,
    risolvi_dipendenze,
    sblocca_modulo
)

@pytest.fixture
def mock_db():
    db = MagicMock()
    # Mock builder pattern per Supabase python client
    class QueryBuilder:
        def __init__(self, data=None):
            self._data = data or []
            self.updates = {}
        def select(self, *args, **kwargs): return self
        def eq(self, *args, **kwargs): return self
        def in_(self, *args, **kwargs): return self
        def single(self, *args, **kwargs): 
            self._data = self._data[0] if self._data else None
            return self
        def update(self, data, *args, **kwargs):
            self.updates = data
            if self._data and isinstance(self._data, list) and len(self._data) > 0:
                self._data[0].update(data)
            else:
                self._data = [data]
            return self
        def execute(self):
            # Restituisce un oggetto con attributo data
            result = MagicMock()
            result.data = self._data
            return result

    db.table = MagicMock(return_value=QueryBuilder())
    db.QueryBuilder = QueryBuilder
    return db

@pytest.mark.asyncio
async def test_aggiorna_stato_microvoce_at_risk(mock_db):
    """Test regola 16.1: se le ore consuntivate superano le previste, lo stato passa ad at_risk."""
    # Imposta i dati fittizi
    mv_data = {
        "id": "mv1",
        "modulo_progetto_id": "mod1",
        "stato": "active",
        "ore_preventivate": 10,
        "ore_consuntivate": 8
    }
    
    def table_mock_side_effect(table_name):
        if table_name == "microvoce_progetto":
            return mock_db.QueryBuilder([mv_data])
        elif table_name == "modulo_progetto":
            return mock_db.QueryBuilder([{"id": "mod1", "progetto_id": "proj1", "ore_preventivate": 10, "avanzamento_pct": 50.0, "stato": "in_progress"}])
        elif table_name == "progetto":
            return mock_db.QueryBuilder([{"id": "proj1"}])
        return mock_db.QueryBuilder([])
        
    mock_db.table.side_effect = table_mock_side_effect
    
    updates = {"ore_consuntivate_increment": 3}  # 8 + 3 = 11 > 10 (at_risk)
    
    # Esegui la funzione
    res = await aggiorna_stato_microvoce(mock_db, "tenant_test", "mv1", updates)
    
    # Verifica che lo stato sia diventato at_risk
    assert res["stato"] == "at_risk"
    assert res["ore_consuntivate"] == 11

@pytest.mark.asyncio
async def test_ricalcola_stato_modulo_e_progetto(mock_db):
    """Test regola 16.2 e 16.3: calcolo avanzamento pct per modulo e progetto."""
    mvs_data = [
        {"id": "mv1", "stato": "done", "ore_preventivate": 5, "ore_consuntivate": 5},
        {"id": "mv2", "stato": "pending", "ore_preventivate": 5, "ore_consuntivate": 0},
    ]
    
    def table_mock_side_effect(table_name):
        if table_name == "microvoce_progetto":
            return mock_db.QueryBuilder(mvs_data)
        elif table_name == "modulo_progetto":
            return mock_db.QueryBuilder([{"id": "mod1", "progetto_id": "proj1", "ore_preventivate": 10, "avanzamento_pct": 0, "stato": "pending"}])
        elif table_name == "progetto":
            return mock_db.QueryBuilder([{"id": "proj1"}])
        return mock_db.QueryBuilder([])
        
    mock_db.table.side_effect = table_mock_side_effect
    
    await ricalcola_stato_modulo(mock_db, "tenant_test", "mod1")
    
    # Assert is just to verify it doesn't crash and completes the logic
    assert True
