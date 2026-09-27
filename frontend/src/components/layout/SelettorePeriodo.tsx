// Selettore di Periodo/Esercizio nella barra in alto. Pilota il periodo globale (usePeriodo),
// che le pagine con filtro data usano come default. Sempre visibile e azzerabile (regola 7): un
// chip mostra il periodo attivo o «Tutto», così non capita di credere spariti dati che ci sono.

import { useState, useRef, useEffect } from 'react';
import { usePeriodo } from '../../context/PeriodoContext';
import { FiltroPeriodo } from '../ui/FiltroPeriodo';

function etichettaPeriodo(dataDa: string, dataA: string, attivo: boolean): string {
  if (!attivo) return 'Tutto';
  const annoPieno = /^(\d{4})-01-01$/.exec(dataDa);
  if (annoPieno && dataA === `${annoPieno[1]}-12-31`) return annoPieno[1];
  return `${dataDa || '…'} → ${dataA || '…'}`;
}

export function SelettorePeriodo() {
  const { dataDa, dataA, attivo, setPeriodo, setAnno, azzera } = usePeriodo();
  const [aperto, setAperto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aperto) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAperto(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [aperto]);

  const annoCorrente = new Date().getFullYear();
  const anni = [annoCorrente, annoCorrente - 1, annoCorrente - 2];
  const annoAttivo = attivo && /^(\d{4})-01-01$/.test(dataDa) && dataA === `${dataDa.slice(0, 4)}-12-31` ? dataDa.slice(0, 4) : null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setAperto(o => !o)}
        title="Periodo/Esercizio: filtra progetti, fatture, scadenzario e documenti"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
          border: `1px solid ${attivo ? 'var(--indigo)' : 'var(--border)'}`,
          background: attivo ? 'var(--pill-blue-bg)' : 'var(--card2)',
          color: attivo ? 'var(--pill-blue-fg)' : 'var(--text)',
        }}
      >
        <span aria-hidden>📅</span>
        <span>Periodo: <strong>{etichettaPeriodo(dataDa, dataA, attivo)}</strong></span>
        {attivo && (
          <span
            role="button"
            aria-label="Azzera periodo"
            onClick={e => { e.stopPropagation(); azzera(); }}
            style={{ marginLeft: 2, fontWeight: 700, opacity: 0.8 }}
          >
            ✕
          </span>
        )}
      </button>

      {aperto && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
            boxShadow: 'var(--shadow-lg)', padding: 14, minWidth: 260,
            display: 'flex', flexDirection: 'column', gap: 12,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Esercizio</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {anni.map(anno => (
              <button
                key={anno}
                type="button"
                onClick={() => { setAnno(anno); setAperto(false); }}
                className={annoAttivo === String(anno) ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              >
                {anno}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { azzera(); setAperto(false); }}
              className={!attivo ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
            >
              Tutto
            </button>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Intervallo personalizzato</div>
          <FiltroPeriodo
            dataDa={dataDa}
            dataA={dataA}
            onDataDa={v => setPeriodo(v, dataA)}
            onDataA={v => setPeriodo(dataDa, v)}
          />
        </div>
      )}
    </div>
  );
}
