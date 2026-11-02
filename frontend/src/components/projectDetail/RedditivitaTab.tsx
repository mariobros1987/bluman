import { CatBadge } from '../ui/CatBadge';
import { fmt } from '../../utils';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import type { MicroVoce, ModuloProgetto, Progetto, TeamMember } from '../../types';

/** Ore e costo di un operatore sulla pratica. `costo` somma solo le ore con costo orario noto. */
interface Contributo {
  nome: string;
  ruolo: string;
  /** Centesimi/ora; `null` non configurato, `undefined` non visibile al ruolo collegato. */
  costoOrarioCentesimi: number | null | undefined;
  ore: number;
  costo: number;
}

/** Testo del costo orario quando non c'è un numero da mostrare. */
function costoOrarioMancante(c: number | null | undefined): string {
  return c === undefined ? 'non disponibile' : 'non configurato';
}

// ─── Componente Redditività Incarico & Report Margini ──────────────
export function RedditivitaTab({
  project,
}: {
  project: Progetto;
}) {
  const { team, loading: caricamentoTeam } = useTeamMembers();

  // F1 — niente `|| 38000`: senza valore il margine non si calcola, si dichiara.
  const valoreTotale: number | null = project.val > 0 ? project.val : null;

  // L'operatore di una micro-voce: prima l'uuid assegnato, poi l'id della UI, poi il primo del
  // team del modulo. Nessun operatore «1» di ripiego: chi non è assegnato resta non assegnato.
  const operatore = (m: ModuloProgetto, mv?: MicroVoce): { chiave: string; membro: TeamMember | undefined } => {
    const perDb = mv?.risorsaId ? team.find(t => t.dbId === mv.risorsaId) : undefined;
    if (perDb) return { chiave: perDb.dbId, membro: perDb };
    const idUi = mv?.as ?? m.team?.[0];
    if (idUi == null) return { chiave: 'non-assegnato', membro: undefined };
    const membro = team.find(t => t.id === idUi);
    return { chiave: membro?.dbId ?? `ui-${idUi}`, membro };
  };

  // Calcolo ore e costi per micro-voce, col costo orario configurato sull'utente dello studio.
  let costoOperativoStudioReale = 0;
  let oreSenzaCosto = 0;
  let oreStimateTot = 0;
  let oreConsuntivateTot = 0;
  const teamContributions: Record<string, Contributo> = {};
  const costiModulo: { costo: number; parziale: boolean }[] = [];

  const registra = (m: ModuloProgetto, ore: number, mv?: MicroVoce) => {
    const { chiave, membro } = operatore(m, mv);
    const costoOrario = membro?.costoOrarioCentesimi;
    const costo = costoOrario != null ? ore * (costoOrario / 100) : 0;
    const noto = costoOrario != null || ore === 0;
    if (!teamContributions[chiave]) {
      teamContributions[chiave] = {
        nome: membro?.n ?? (chiave === 'non-assegnato' ? 'Non assegnato' : `Operatore non trovato (${chiave.slice(3)})`),
        ruolo: membro?.r ?? '—',
        costoOrarioCentesimi: membro ? costoOrario : null,
        ore: 0,
        costo: 0,
      };
    }
    teamContributions[chiave].ore += ore;
    teamContributions[chiave].costo += costo;
    costoOperativoStudioReale += costo;
    if (!noto) oreSenzaCosto += ore;
    return { costo, parziale: !noto };
  };

  (project.mods || []).forEach(m => {
    oreStimateTot += (m.h || 0);
    oreConsuntivateTot += (m.a || 0);
    const voci = m.v && m.v.length > 0 ? m.v.map(mv => registra(m, mv.hA || 0, mv)) : [registra(m, m.a || 0)];
    costiModulo.push({
      costo: voci.reduce((acc, v) => acc + v.costo, 0),
      parziale: voci.some(v => v.parziale),
    });
  });

  // Margine dichiarato parziale se qualche ora non ha un costo orario: si somma solo ciò che è noto.
  const margineParziale = oreSenzaCosto > 0;
  const margineLordo: number | null = valoreTotale !== null ? valoreTotale - costoOperativoStudioReale : null;
  const marginePercentuale = valoreTotale !== null && margineLordo !== null ? (margineLordo / valoreTotale) * 100 : null;
  const percentualeBudgetCosumata = valoreTotale !== null ? (costoOperativoStudioReale / valoreTotale) * 100 : null;

  // Resa Oraria Effettiva Studio (€/ora): solo con valore e ore consuntivate.
  const resaOrariaStudio = valoreTotale !== null && oreConsuntivateTot > 0 ? valoreTotale / oreConsuntivateTot : null;

  // Semaforo Alert: solo su un margine completo; parziale o non calcolato si dichiara come tale.
  const semaforoStato = marginePercentuale === null || margineParziale
    ? 'neutro'
    : marginePercentuale >= 50 ? 'green' : marginePercentuale >= 20 ? 'yellow' : 'red';
  const semaforoText = semaforoStato === 'neutro'
    ? (valoreTotale === null ? '⚪ Valore non impostato: margine non calcolato' : '⚪ Margine parziale: costi orari mancanti')
    : semaforoStato === 'green' ? '🟢 Margine Ottimale (>50%)' : semaforoStato === 'yellow' ? '🟡 Margine in Linea (20% - 50%)' : '🔴 Attenzione: Sforamento Budget';
  const semaforoBg = semaforoStato === 'neutro' ? 'var(--card)' : semaforoStato === 'green' ? 'var(--pill-green-bg)' : semaforoStato === 'yellow' ? 'var(--pill-amber-bg)' : 'var(--pill-red-bg)';
  const semaforoBorder = semaforoStato === 'neutro' ? 'var(--border)' : semaforoStato === 'green' ? 'var(--green)' : semaforoStato === 'yellow' ? 'var(--amber)' : 'var(--red)';
  const semaforoColor = semaforoStato === 'neutro' ? 'var(--muted)' : semaforoStato === 'green' ? 'var(--green)' : semaforoStato === 'yellow' ? 'var(--amber)' : 'var(--pill-red-fg)';
  const notaParziale = `Margine parziale: ${oreSenzaCosto.toFixed(1)} h senza costo orario configurato non sono nel costo.`;

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
              ['Valore Incarico', valoreTotale !== null ? valoreTotale.toFixed(2) : 'non impostato'],
              ['Costo Lavoro Studio Reale', `${costoOperativoStudioReale.toFixed(2)}${margineParziale ? ' (parziale)' : ''}`],
              ['Margine Lordo Studio', margineLordo !== null ? `${margineLordo.toFixed(2)}${margineParziale ? ' (parziale)' : ''}` : 'non calcolato'],
              ['Margine Percentuale', marginePercentuale !== null ? `${marginePercentuale.toFixed(1)}%` : 'non calcolato'],
              ['Ore Stimate', oreStimateTot.toFixed(1)],
              ['Ore Consuntivate', oreConsuntivateTot.toFixed(1)],
              ['Ore senza costo orario', oreSenzaCosto.toFixed(1)],
              [],
              ['Modulo', 'Prezzo', 'Ore Stimate', 'Ore Reali', 'Costo Lavoro Studio', 'Margine Modulo'],
              ...(project.mods || []).map((m, idx) => {
                const c = costiModulo[idx] ?? { costo: 0, parziale: false };
                const nota = c.parziale ? ' (parziale)' : '';
                return [
                  m.n,
                  (m.p || 0).toFixed(2),
                  (m.h || 0).toFixed(1),
                  (m.a || 0).toFixed(1),
                  `${c.costo.toFixed(2)}${nota}`,
                  `${((m.p || 0) - c.costo).toFixed(2)}${nota}`,
                ];
              })
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
          {valoreTotale !== null ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', marginTop: 4 }}>{fmt(valoreTotale)}</div>
              <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>✓ Concordato a contrattazione</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--muted)', marginTop: 4 }}>valore non impostato</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Impostalo sul progetto per calcolare il margine</div>
            </>
          )}
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
          {margineLordo !== null && marginePercentuale !== null ? (
            <div style={{ fontSize: 22, fontWeight: 800, color: margineLordo >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 4 }}>
              {fmt(margineLordo)} <span style={{ fontSize: 13, fontWeight: 600 }}>({marginePercentuale.toFixed(1)}%)</span>
            </div>
          ) : (
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--muted)', marginTop: 4 }}>margine non calcolato</div>
          )}
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
            Costo Lavoro Studio: {caricamentoTeam ? 'caricamento costi…' : fmt(costoOperativoStudioReale)}
          </div>
          {!caricamentoTeam && margineParziale && (
            <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 2 }} title="Il costo somma solo le ore degli operatori con un costo orario configurato.">
              {notaParziale}
            </div>
          )}
        </div>

        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>⚡ Resa Oraria Effettiva</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--amber)', marginTop: 4 }}>{resaOrariaStudio !== null ? `${fmt(resaOrariaStudio)} / h` : '—'}</div>
          <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>Target Studio: € 200 / h</div>
        </div>
      </div>

      {/* 📈 GAUGE CONSUMO BUDGET COMMESSA */}
      {percentualeBudgetCosumata !== null && (
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 12 }}>
            <span style={{ fontWeight: 700 }}>📉 Consumo Budget Lavoro Studio:</span>
            <span style={{ fontWeight: 800, color: semaforoColor }}>{percentualeBudgetCosumata.toFixed(1)}% del valore vendita utilizzato{margineParziale ? ' (parziale)' : ''}</span>
          </div>
          <div style={{ width: '100%', height: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 6, overflow: 'hidden', display: 'flex' }}>
            <div style={{ width: `${Math.min(100, percentualeBudgetCosumata)}%`, background: semaforoColor, transition: 'width 0.4s ease' }} />
          </div>
        </div>
      )}

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
                <th style={{ padding: '8px 12px' }}>Costo Orario</th>
                <th style={{ padding: '8px 12px' }}>Ore Registrate</th>
                <th style={{ padding: '8px 12px' }}>Costo Totale Studio</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(teamContributions).map(([chiave, data]) => (
                <tr key={chiave} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--text)' }}>
                    👤 {data.nome}
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                    {data.ruolo}
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                    {caricamentoTeam
                      ? 'caricamento…'
                      : data.costoOrarioCentesimi != null
                        ? `${fmt(data.costoOrarioCentesimi / 100)} / h`
                        : <span style={{ color: 'var(--amber)' }} title="Il costo orario si imposta nella scheda dell'utente dello studio.">{costoOrarioMancante(data.costoOrarioCentesimi)}</span>}
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--indigo-l)' }}>
                    {data.ore.toFixed(1)} h
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--green)' }}>
                    {data.costoOrarioCentesimi != null ? `€ ${data.costo.toFixed(2)}` : '—'}
                  </td>
                </tr>
              ))}
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
                const { costo: modCostoStudio, parziale: modParziale } = costiModulo[idx] ?? { costo: 0, parziale: false };
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
                      {fmt(modCostoStudio)}{modParziale ? ' (parziale)' : ''}
                    </td>
                    <td style={{ padding: '12px', fontWeight: 700, color: modMargine >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {calcolabile ? `${fmt(modMargine)}${modParziale ? ' (parziale)' : ''}` : '—'}
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
