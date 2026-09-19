import { CatBadge } from '../ui/CatBadge';
import { fmt } from '../../utils';
import type { ModuloProposta } from './types';
import { docBoxStyle } from './styles';

export interface TabAvanzamentoProps {
  moduliProposti: ModuloProposta[];
  percentualeProgetto: number;
  moduleSignatures: Record<string, { firmato: boolean; dataFirma: string; signerName: string }>;
  setSelectedModule: (modulo: ModuloProposta | null) => void;
}

export function TabAvanzamento({
  moduliProposti,
  percentualeProgetto,
  moduleSignatures,
  setSelectedModule,
}: TabAvanzamentoProps) {
  return (
    <div style={docBoxStyle}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>📊 Stato Avanzamento Lavori in Tempo Reale</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 18 }}>
        Monitora le prestazioni specialistiche e i passaggi eseguiti dall'advisor per ciascun modulo. Clicca su un modulo per visualizzare i dettagli o firmare la conclusione dell'operazione.
      </div>

      {/* Progress Bar — percentuale calcolata dal backend (§16), non una soglia minima */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
          <span>Progresso Generale Fascicoli & Incarico</span>
          <span style={{ color: 'var(--indigo-l)', fontWeight: 800 }}>
            {moduliProposti.length === 0
              ? 'Non ancora avviato'
              : `${percentualeProgetto}%${percentualeProgetto >= 100 ? ' Concluso' : ' in lavorazione'}`}
          </span>
        </div>
        <div style={{ width: '100%', height: 10, background: 'var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div
            style={{
              width: `${percentualeProgetto}%`,
              height: '100%',
              background: 'linear-gradient(90deg, var(--indigo), var(--green))',
              borderRadius: 10,
              transition: 'width .3s ease',
            }}
          />
        </div>
      </div>

      {/* Elenco Moduli con Avanzamento Live e Click per Dettagli */}
      <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)', marginBottom: 12 }}>
        Fascicoli Operativi in Corso & Conclusi ({moduliProposti.length})
      </div>

      {moduliProposti.length === 0 && (
        <div style={{ background: 'var(--card2)', border: '1px dashed var(--border)', borderRadius: 12, padding: 18, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          Non ci sono ancora fascicoli operativi aperti su questo progetto. Quando lo Studio
          avvia le lavorazioni trovi qui i moduli, con le micro-fasi effettivamente eseguite
          e l'operatore che le ha svolte.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {moduliProposti.map((m, idx) => {
          const isSigned = moduleSignatures[m.id]?.firmato;
          const isDone = isSigned || m.stato === 'completato';
          // Solo passaggi reali: quando il modulo non ha micro-voci a database l'elenco
          // resta vuoto invece di essere rimpiazzato da fasi cablate già spuntate.
          const passaggi = m.passaggi || [];
          const passaggiCompletati = isSigned ? passaggi.length : passaggi.filter(p => p.completato).length;

          return (
            <div
              key={m.id || idx}
              onClick={() => setSelectedModule(m)}
              style={{
                background: isSigned ? 'var(--pill-green-bg)' : 'var(--card2)',
                border: isSigned ? '1.5px solid var(--green)' : isDone ? '1.5px solid var(--indigo)' : '1px solid var(--border)',
                borderRadius: 14,
                padding: 18,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                boxShadow: '0 4px 14px rgba(0,0,0,.25)',
                transition: 'all .2s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: isSigned ? 'var(--green)' : isDone ? 'var(--indigo-d)' : 'var(--card)',
                      color: isSigned ? 'var(--pill-green-bg)' : '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      fontSize: 14,
                    }}
                  >
                    {isSigned ? '✓' : isDone ? '✍️' : idx + 1}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <CatBadge cat={m.cat} />
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{m.nome}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {m.operatore
                        ? <>Operatore: <strong style={{ color: 'var(--text)' }}>{m.operatore}</strong> · </>
                        : <>Operatore non ancora assegnato · </>}
                      Stima: {m.ore}h
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {isSigned ? (
                    <span style={{ background: 'var(--green)', color: 'var(--pill-green-bg)', fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 12 }}>
                      ✓ CONCLUSO & VALIDATO
                    </span>
                  ) : isDone ? (
                    <span style={{ background: 'var(--amber)', color: '#000', fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 12 }}>
                      ✍️ ATTIVITÀ CONCLUSE (DA FIRMARE)
                    </span>
                  ) : (
                    <span style={{ background: 'var(--pill-indigo-bg)', color: 'var(--purple)', fontSize: 10.5, fontWeight: 700, padding: '4px 10px', borderRadius: 12 }}>
                      ⏱ IN LAVORAZIONE ({m.percentuale ?? 0}%)
                    </span>
                  )}
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--indigo-l)' }}>{fmt(m.prezzo)}</div>
                </div>
              </div>

              {/* Mini Avanzamento Passaggi & Documenti */}
              <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--muted)' }}>
                    Progressione operativa: <strong style={{ color: 'var(--green)' }}>{passaggiCompletati}/{passaggi.length} micro-fasi</strong>
                  </span>
                  {m.deliverables && m.deliverables.length > 0 && (
                    <span style={{ background: 'var(--pill-indigo-bg)', border: '1px solid var(--indigo-d)', color: 'var(--pill-indigo-fg)', padding: '2px 8px', borderRadius: 6, fontWeight: 700, fontSize: 10 }}>
                      📄 {m.deliverables.length} atto/i pubblicato/i
                    </span>
                  )}
                </div>
                <div style={{ color: 'var(--indigo-l)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>👁 Visualizza attività & documenti</span> ➔
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
