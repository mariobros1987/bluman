// Filtro per intervallo di date riutilizzabile per le barre filtri (Progetti, Fatture,
// Scadenzario, Documenti). Due `<input type="date">` "Da"/"A" indipendenti: entrambi opzionali,
// così si filtra anche solo da un lato. Stile coerente col design system (regola 15): l'input
// eredita la regola globale su `input` in tokens.css; qui si vincola solo la larghezza compatta
// da barra filtri e si usano i token per colori/bordi.

interface FiltroPeriodoProps {
  dataDa: string;
  dataA: string;
  onDataDa: (valore: string) => void;
  onDataA: (valore: string) => void;
}

const stileInput: React.CSSProperties = {
  width: 'auto',
  padding: '6px 10px',
  fontSize: 12,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--card2)',
  color: 'var(--text)',
};

const stileEtichetta: React.CSSProperties = {
  fontSize: 11.5,
  color: 'var(--muted)',
};

export function FiltroPeriodo({ dataDa, dataA, onDataDa, onDataA }: FiltroPeriodoProps) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <label style={stileEtichetta}>Da</label>
      <input
        type="date"
        aria-label="Data inizio periodo"
        value={dataDa}
        max={dataA || undefined}
        onChange={e => onDataDa(e.target.value)}
        style={stileInput}
      />
      <label style={stileEtichetta}>A</label>
      <input
        type="date"
        aria-label="Data fine periodo"
        value={dataA}
        min={dataDa || undefined}
        onChange={e => onDataA(e.target.value)}
        style={stileInput}
      />
    </div>
  );
}
