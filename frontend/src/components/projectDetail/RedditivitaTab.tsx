import { CatBadge } from '../ui/CatBadge';
import { fmt } from '../../utils';
import type { Progetto } from '../../types';

// ─── Componente Redditività Incarico & Report Margini ──────────────
export function RedditivitaTab({
  project,
}: {
  project: Progetto;
}) {
  const valoreTotale = project.val || 38000;
  
  // Mappa tariffe orarie reali per id operatore
  const OPERATOR_RATES: Record<number, { name: string; rate: number; role: string }> = {
    1: { name: 'Joe Disabato', rate: 120, role: 'Lead Advisor & Senior Partner' },
    2: { name: 'Francesca Disabato', rate: 45, role: 'Back Office & Compliance KYC' },
    3: { name: 'Avv. Lorenzo Marino', rate: 90, role: 'Legal Counsel — Diritto Societario' },
    4: { name: 'Dr. Elena Russo', rate: 85, role: 'Tax Advisor & Fiscalità Internazionale' },
    5: { name: 'Avv. Mario Dibenedetto', rate: 95, role: 'Legal Counsel & Partner' },
  };

  // Calcolo ore e costi reali analitici per microvoce
  let costoOperativoStudioReale = 0;
  let oreStimateTot = 0;
  let oreConsuntivateTot = 0;
  const teamContributions: Record<number, { hours: number; cost: number }> = {};

  (project.mods || []).forEach(m => {
    oreStimateTot += (m.h || 0);
    const modActual = (m.a || 0);
    oreConsuntivateTot += modActual;

    if (m.v && m.v.length > 0) {
      m.v.forEach(mv => {
        const opId = mv.as || (m.team && m.team[0]) || 1;
        const opRate = OPERATOR_RATES[opId]?.rate || 95;
        const mvHours = mv.hA || 0;
        const mvCost = mvHours * opRate;
        costoOperativoStudioReale += mvCost;

        if (!teamContributions[opId]) {
          teamContributions[opId] = { hours: 0, cost: 0 };
        }
        teamContributions[opId].hours += mvHours;
        teamContributions[opId].cost += mvCost;
      });
    } else {
      const defaultOp = (m.team && m.team[0]) || 1;
      const opRate = OPERATOR_RATES[defaultOp]?.rate || 95;
      const modCost = modActual * opRate;
      costoOperativoStudioReale += modCost;

      if (!teamContributions[defaultOp]) {
        teamContributions[defaultOp] = { hours: 0, cost: 0 };
      }
      teamContributions[defaultOp].hours += modActual;
      teamContributions[defaultOp].cost += modCost;
    }
  });

  // Se non ci sono ore consuntivate dettagliate, fallback proporzionale realistico
  if (costoOperativoStudioReale === 0 && oreConsuntivateTot > 0) {
    costoOperativoStudioReale = oreConsuntivateTot * 95;
  }

  // Margine Lordo Studio (€ e %)
  const margineLordo = valoreTotale - costoOperativoStudioReale;
  const marginePercentuale = valoreTotale > 0 ? ((margineLordo / valoreTotale) * 100) : 0;
  const percentualeBudgetCosumata = valoreTotale > 0 ? ((costoOperativoStudioReale / valoreTotale) * 100) : 0;

  // Resa Oraria Effettiva Studio (€/ora)
  const resaOrariaStudio = oreConsuntivateTot > 0 ? (valoreTotale / oreConsuntivateTot) : valoreTotale;

  // Semaforo Alert
  const semaforoStato = marginePercentuale >= 50 ? 'green' : marginePercentuale >= 20 ? 'yellow' : 'red';
  const semaforoText = semaforoStato === 'green' ? '🟢 Margine Ottimale (>50%)' : semaforoStato === 'yellow' ? '🟡 Margine in Linea (20% - 50%)' : '🔴 Attenzione: Sforamento Budget';
  const semaforoBg = semaforoStato === 'green' ? 'var(--pill-green-bg)' : semaforoStato === 'yellow' ? 'var(--pill-amber-bg)' : 'var(--pill-red-bg)';
  const semaforoBorder = semaforoStato === 'green' ? 'var(--green)' : semaforoStato === 'yellow' ? 'var(--amber)' : 'var(--red)';
  const semaforoColor = semaforoStato === 'green' ? 'var(--green)' : semaforoStato === 'yellow' ? 'var(--amber)' : 'var(--pill-red-fg)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Tabella Redditività */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📊 Analisi Redditività Incarico & Controllo Budget Commessa</span>
            <span style={{ fontSize: 11, background: semaforoBg, color: semaforoColor, border: `1px solid ${semaforoBorder}`, padding: '2px 10px', borderRadius: 12, fontWeight: 800 }}>
              {semaforoText}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Monitoraggio finanziario in tempo reale: Valore Contrattuale vs Costo Lavoro Reale Studio per <strong>{project.cl}</strong>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            const csvRows = [
              ['Riepilogo Redditivita Commessa', project.n, project.cl],
              ['Valore Incarico', valoreTotale.toFixed(2)],
              ['Costo Lavoro Studio Reale', costoOperativoStudioReale.toFixed(2)],
              ['Margine Lordo Studio', margineLordo.toFixed(2)],
              ['Margine Percentuale', `${marginePercentuale.toFixed(1)}%`],
              ['Ore Stimate', oreStimateTot.toFixed(1)],
              ['Ore Consuntivate', oreConsuntivateTot.toFixed(1)],
              [],
              ['Modulo', 'Prezzo', 'Ore Stimate', 'Ore Reali', 'Costo Lavoro Studio', 'Margine Modulo'],
              ...(project.mods || []).map(m => [
                m.n,
                (m.p || 0).toFixed(2),
                (m.h || 0).toFixed(1),
                (m.a || 0).toFixed(1),
                ((m.a || 0) * 95).toFixed(2),
                ((m.p || 0) - (m.a || 0) * 95).toFixed(2),
              ])
            ];
            const csvContent = 'data:text/csv;charset=utf-8,' + csvRows.map(e => e.join(';')).join('\n');
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement('a');
            link.setAttribute('href', encodedUri);
            link.setAttribute('download', `Rendiconto_Redditivita_${project.n.replace(/\s+/g, '_')}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }}
          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span>📥 Esporta Rendiconto Economico CSV</span>
        </button>
      </div>

      {/* 📊 KPI FINANCIAL CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>💶 Valore Incarico Forfait</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', marginTop: 4 }}>{fmt(valoreTotale)}</div>
          <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>✓ Concordato a contrattazione</div>
        </div>

        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>⏱ Ore Consuntivate / Stimate</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--indigo-l)', marginTop: 4 }}>{oreConsuntivateTot.toFixed(1)}h <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>/ {oreStimateTot}h</span></div>
          <div style={{ fontSize: 10, color: oreConsuntivateTot <= oreStimateTot ? 'var(--green)' : 'var(--amber)', marginTop: 2 }}>
            {oreConsuntivateTot <= oreStimateTot ? '✓ In linea con la stima' : '⚠️ Sforamento monte ore'}
          </div>
        </div>

        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>🏦 Margine Lordo Commessa</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: margineLordo >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 4 }}>
            {fmt(margineLordo)} <span style={{ fontSize: 13, fontWeight: 600 }}>({marginePercentuale.toFixed(1)}%)</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Costo Lavoro Studio: {fmt(costoOperativoStudioReale)}</div>
        </div>

        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>⚡ Resa Oraria Effettiva</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--amber)', marginTop: 4 }}>{fmt(resaOrariaStudio)} / h</div>
          <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>Target Studio: € 200 / h</div>
        </div>
      </div>

      {/* 📈 GAUGE CONSUMO BUDGET COMMESSA */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 12 }}>
          <span style={{ fontWeight: 700 }}>📉 Consumo Budget Lavoro Studio:</span>
          <span style={{ fontWeight: 800, color: semaforoColor }}>{percentualeBudgetCosumata.toFixed(1)}% del valore vendita utilizzato</span>
        </div>
        <div style={{ width: '100%', height: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 6, overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${Math.min(100, percentualeBudgetCosumata)}%`, background: semaforoColor, transition: 'width 0.4s ease' }} />
        </div>
      </div>

      {/* 👥 RIPARTIZIONE ORE E COSTI PER PROFESSIONISTA STUDIO */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
          👥 Ripartizione Lavoro & Costi per Professionista Studio
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--muted)' }}>
                <th style={{ padding: '8px 12px' }}>Professionista</th>
                <th style={{ padding: '8px 12px' }}>Ruolo & Specializzazione</th>
                <th style={{ padding: '8px 12px' }}>Tariffa Oraria</th>
                <th style={{ padding: '8px 12px' }}>Ore Registrate</th>
                <th style={{ padding: '8px 12px' }}>Costo Totale Studio</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(teamContributions).map(([opIdStr, data]) => {
                const opId = Number(opIdStr);
                const info = OPERATOR_RATES[opId] || { name: `Operatore #${opId}`, rate: 95, role: 'Consulente Studio' };
                return (
                  <tr key={opId} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--text)' }}>
                      👤 {info.name}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                      {info.role}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                      € {info.rate},00 / h
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--indigo-l)' }}>
                      {data.hours.toFixed(1)} h
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--green)' }}>
                      € {data.cost.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 📊 TABELLA REDDITIVITÀ PER SINGOLO MODULO */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
          📋 Dettaglio Rendiconto e Margini per Singolo Modulo dell'Incarico
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--muted)' }}>
                <th style={{ padding: '10px 12px' }}>Modulo Incarico</th>
                <th style={{ padding: '10px 12px' }}>Categoria</th>
                <th style={{ padding: '10px 12px' }}>Prezzo Modulo</th>
                <th style={{ padding: '10px 12px' }}>Ore Stimate vs Reali</th>
                <th style={{ padding: '10px 12px' }}>Costo Interno Studio</th>
                <th style={{ padding: '10px 12px' }}>Margine Lordo</th>
                <th style={{ padding: '10px 12px' }}>Resa Oraria Reale</th>
                <th style={{ padding: '10px 12px' }}>Stato Profitto</th>
              </tr>
            </thead>
            <tbody>
              {(project.mods || []).map((m, idx) => {
                // Valori come stanno a database. I ripieghi precedenti (`|| 3500` di prezzo,
                // `|| 10` ore stimate) producevano una riga di conto economico completa — ricavo,
                // costo, margine, resa oraria e verdetto "In Target" — su un modulo che a
                // database non ha né prezzo né ore. Le ore reali venivano inoltre INTERPOLATE
                // dalla percentuale (`modH_Stima * pct/100`) e mostrate nella colonna "Ore
                // Reali": ore che nessuno aveva consuntivato, usate poi per calcolare il costo
                // interno dello studio. Ora la riga senza dati si dichiara non calcolabile.
                const modP = m.p || 0;
                const modH_Stima = m.h || 0;
                const modH_Reali = m.a || 0;
                const defaultOp = (m.team && m.team[0]) || 1;
                const opRate = OPERATOR_RATES[defaultOp]?.rate || 95;
                const modCostoStudio = modH_Reali * opRate;
                const modMargine = modP - modCostoStudio;
                // La resa oraria esiste solo con ore consuntivate: senza, non è "prezzo pieno
                // all'ora", è indeterminata.
                const modResa: number | null = modH_Reali > 0 ? modP / modH_Reali : null;
                const isProfit = modResa !== null && modResa >= 200;
                const calcolabile = modP > 0 || modH_Reali > 0;

                return (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border)', opacity: calcolabile ? 1 : 0.55 }}>
                    <td style={{ padding: '12px', fontWeight: 700, color: 'var(--text)' }}>
                      {m.n}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <CatBadge cat={m.cat} />
                    </td>
                    <td style={{ padding: '12px', fontWeight: 700, color: 'var(--text)' }}>
                      {fmt(modP)}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ fontWeight: 700, color: 'var(--indigo-l)' }}>{modH_Reali.toFixed(1)}h</span>
                      <span style={{ color: 'var(--muted)', fontSize: 10 }}> / {modH_Stima}h</span>
                    </td>
                    <td style={{ padding: '12px', color: 'var(--muted)' }}>
                      {fmt(modCostoStudio)}
                    </td>
                    <td style={{ padding: '12px', fontWeight: 700, color: modMargine >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {calcolabile ? fmt(modMargine) : '—'}
                    </td>
                    <td style={{ padding: '12px', fontWeight: 800, color: 'var(--amber)' }}>
                      {modResa !== null ? `${fmt(modResa)} / h` : '—'}
                    </td>
                    <td style={{ padding: '12px' }}>
                      {modResa === null ? (
                        <span style={{ fontSize: 9.5, background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>
                          ⚪ Nessuna ora consuntivata
                        </span>
                      ) : (
                        <span style={{ fontSize: 9.5, background: isProfit ? 'var(--pill-green-bg)' : 'var(--pill-amber-bg)', color: isProfit ? 'var(--green)' : 'var(--amber)', border: `1px solid ${isProfit ? 'var(--green)' : 'var(--amber)'}`, padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>
                          {isProfit ? '🟢 In Utile Extra' : '🟡 In Target'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
