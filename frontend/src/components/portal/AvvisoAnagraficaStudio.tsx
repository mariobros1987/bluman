// Al posto della lettera d'incarico finché l'anagrafica dello studio non è arrivata dal server.
// La lettera stampa la controparte (nome, sede, P.IVA, IBAN dello studio): senza i dati del
// database la si comporrebbe con quelli che il browser ha in memoria, e il cliente leggerebbe una
// controparte diversa da quella che il sigillo della firma registra. Per questo né la lettera né
// i comandi di firma si mostrano prima.
export type StatoAnagraficaStudio = 'caricamento' | 'ok' | 'errore';

export function AvvisoAnagraficaStudio({ stato, onRiprova }: { stato: StatoAnagraficaStudio; onRiprova: () => void }) {
  if (stato === 'caricamento') {
    return (
      <div style={{ marginTop: 24, padding: 24, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card2)', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
        Caricamento della lettera d'incarico…
      </div>
    );
  }
  return (
    <div role="alert" style={{ marginTop: 24, padding: 20, borderRadius: 12, border: '1px solid var(--pill-red-bd)', background: 'var(--pill-red-bg)', color: 'var(--pill-red-fg)', fontSize: 13, lineHeight: 1.5 }}>
      <strong>La lettera d'incarico non si può mostrare adesso.</strong> Non siamo riusciti a leggere i dati dello studio
      che compaiono nel contratto, quindi per ora non è possibile né leggerla né firmarla.
      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-sm" onClick={onRiprova}>Riprova</button>
      </div>
    </div>
  );
}
