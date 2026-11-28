// La pagina personale del cliente: per ogni incarico, a che punto sono i lavori e cosa tocca a lui.
//
// Stati, percentuali e l'elenco delle cose da fare arrivano dal server (`GET /portal/riepilogo`):
// qui non si calcola niente, si mostra. La regola con cui una cosa finisce in «Tocca a te» è
// scritta sotto l'elenco, in una frase (regola 12).
import type { DocumentoPortale } from '../../api/client';
import type { FaseRiepilogo, RiepilogoProgetto, SchedaAzione } from '../../api/canaleProtetto';
import { azioniDelProgetto, turnoDelProgetto, type AzioneDelProgetto } from './azioniCliente';
import { etichettaFaseModulo } from './faseModulo';
import { fmt } from '../../utils';
import { docBoxStyle } from './styles';
import type { StatoRiepilogo } from './usePortalRiepilogo';

export interface TabRiepilogoProps {
  stato: StatoRiepilogo;
  ricarica: () => void;
  documenti: DocumentoPortale[];
  /** Apre la scheda in cui un'azione si compie, sull'incarico giusto. */
  onApri: (progettoId: string, scheda: SchedaAzione) => void;
}

const ICONE: Record<AzioneDelProgetto['tipo'], string> = {
  firma_incarico: '✍️',
  firma_documento: '🖊️',
  richiesta: '📝',
  conferma_fase: '✅',
  fattura: '💳',
  messaggi: '💬',
};

const ETICHETTA_PULSANTE: Record<AzioneDelProgetto['tipo'], string> = {
  firma_incarico: 'Vai alla firma',
  firma_documento: 'Apri i documenti',
  richiesta: 'Rispondi',
  conferma_fase: 'Controlla e conferma',
  fattura: 'Vedi la fattura',
  messaggi: 'Leggi',
};

function dataBreve(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT');
}

function RigaAzione({ azione, mostraIncarico, onApri }: { azione: AzioneDelProgetto; mostraIncarico: boolean; onApri: TabRiepilogoProps['onApri'] }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap', background: 'var(--card)', border: `1px solid ${azione.urgente ? 'var(--amber)' : 'var(--border)'}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flex: 1, minWidth: 220 }}>
        <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1.2 }}>{ICONE[azione.tipo]}</span>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>
            {azione.titolo}
            {azione.urgente && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: 'var(--amber)', textTransform: 'uppercase' }}>da fare subito</span>}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 2 }}>
            {azione.importoCentesimi !== undefined && azione.scadenza
              ? <>{fmt(azione.importoCentesimi / 100)} · scadenza {dataBreve(azione.scadenza)}. </>
              : null}
            {azione.dettaglio}
            {mostraIncarico && <> Incarico: <strong style={{ color: 'var(--text)' }}>{azione.progettoNome}</strong>.</>}
          </div>
        </div>
      </div>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => onApri(azione.progettoId, azione.scheda)}>
        {ETICHETTA_PULSANTE[azione.tipo]} →
      </button>
    </li>
  );
}

function segnoFase(fase: FaseRiepilogo): { segno: string; colore: string } {
  if (fase.fase === 'completato') return { segno: '✓', colore: 'var(--green)' };
  if (fase.fase === 'in_corso') return { segno: '●', colore: 'var(--indigo)' };
  return { segno: '○', colore: 'var(--muted)' };
}

function RigaFase({ fase, ultima, progettoId, onApri }: { fase: FaseRiepilogo; ultima: boolean; progettoId: string; onApri: TabRiepilogoProps['onApri'] }) {
  const { segno, colore } = segnoFase(fase);
  const etichetta = fase.fase === 'in_attesa' && fase.attende.length > 0
    ? `Inizia dopo: ${fase.attende.join(', ')}`
    : etichettaFaseModulo(fase.fase, fase.percentuale);
  return (
    <li style={{ display: 'flex', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: '50%', border: `2px solid ${colore}`, color: colore, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, background: 'var(--card)' }}>{segno}</span>
        {!ultima && <span aria-hidden="true" style={{ flex: 1, width: 2, background: 'var(--border)', minHeight: 14 }} />}
      </div>
      <div style={{ flex: 1, paddingBottom: ultima ? 0 : 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{fase.nome}</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: colore }}>{etichetta}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
          {fase.attivitaTotali > 0
            ? `${fase.attivitaConcluse} di ${fase.attivitaTotali} attività concluse`
            : 'Lo studio non ha ancora dettagliato le attività di questa fase'}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {fase.richiesteDaFare > 0 && (
            <button type="button" className="btn btn-sm" onClick={() => onApri(progettoId, 'richieste')} style={{ borderColor: 'var(--amber)' }}>
              📝 {fase.richiesteDaFare === 1 ? 'Una richiesta per te' : `${fase.richiesteDaFare} richieste per te`}
            </button>
          )}
          {fase.daConfermare && (
            <button type="button" className="btn btn-sm" onClick={() => onApri(progettoId, 'avanzamento')} style={{ borderColor: 'var(--amber)' }}>
              ✅ Conclusa: aspetta la tua conferma
            </button>
          )}
          {fase.confermata && <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>✓ Confermata da te</span>}
        </div>
      </div>
    </li>
  );
}

function SchedaIncarico({ progetto, azioni, onApri }: { progetto: RiepilogoProgetto; azioni: AzioneDelProgetto[]; onApri: TabRiepilogoProps['onApri'] }) {
  const turno = turnoDelProgetto(progetto, azioni);
  const pillola = turno === 'cliente'
    ? { testo: azioni.length === 1 ? 'Tocca a te: una cosa da fare' : `Tocca a te: ${azioni.length} cose da fare`, sfondo: 'var(--pill-amber-bg)', bordo: 'var(--amber)' }
    : turno === 'concluso'
      ? { testo: 'Incarico concluso', sfondo: 'var(--pill-green-bg)', bordo: 'var(--green)' }
      : { testo: 'Ci sta lavorando lo studio', sfondo: 'var(--pill-indigo-bg)', bordo: 'var(--indigo)' };
  return (
    <section style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }} aria-label={`Incarico ${progetto.nome}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{progetto.nome}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {progetto.numeroContratto ? `Lettera d'incarico ${progetto.numeroContratto} · ` : ''}
            {progetto.letteraFirmata ? 'incarico firmato' : 'incarico non ancora firmato'}
          </div>
        </div>
        <span style={{ background: pillola.sfondo, border: `1px solid ${pillola.bordo}`, color: 'var(--text)', borderRadius: 12, padding: '5px 12px', fontSize: 11.5, fontWeight: 800 }}>{pillola.testo}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 600, marginBottom: 6 }}>
        <span>Avanzamento dei lavori</span>
        <span title="È la percentuale calcolata dal gestionale dello studio sulle attività dell'incarico: arriva a 100 solo quando tutte le fasi sono concluse.">
          {progetto.fasi.length === 0 ? 'Non ancora avviato' : `${progetto.percentuale}%`}
        </span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progetto.percentuale} style={{ height: 8, background: 'var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ width: `${progetto.percentuale}%`, height: '100%', background: 'var(--indigo)' }} />
      </div>

      {progetto.fasi.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          Lo studio non ha ancora aperto le fasi di lavoro di questo incarico. Compariranno qui appena avvia le lavorazioni.
        </div>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {progetto.fasi.map((fase, indice) => (
            <RigaFase key={fase.id} fase={fase} ultima={indice === progetto.fasi.length - 1} progettoId={progetto.id} onApri={onApri} />
          ))}
        </ol>
      )}

      <div style={{ marginTop: 14 }}>
        <button type="button" className="btn btn-sm" onClick={() => onApri(progetto.id, 'avanzamento')}>Vedi le attività e i documenti di ogni fase →</button>
      </div>
    </section>
  );
}

export function TabRiepilogo({ stato, ricarica, documenti, onApri }: TabRiepilogoProps) {
  if (stato.fase === 'caricamento') {
    return <div style={{ ...docBoxStyle, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>⏳ Leggo lo stato dei tuoi incarichi…</div>;
  }
  if (stato.fase === 'errore') {
    return (
      <div style={docBoxStyle} role="alert">
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Lo stato dei tuoi incarichi non si è potuto leggere</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{stato.messaggio} Non vuol dire che non ci sia niente da fare: riprova.</div>
        <button type="button" className="btn btn-primary btn-sm" onClick={ricarica}>Riprova</button>
      </div>
    );
  }

  const progetti = stato.dati.progetti;
  if (progetti.length === 0) {
    return (
      <div style={{ ...docBoxStyle, fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
        Non hai ancora incarichi aperti con lo studio. Quando lo studio ne apre uno lo trovi qui, con le fasi di lavoro e le cose che dovrai fare tu.
      </div>
    );
  }

  const perProgetto = progetti.map((progetto) => ({ progetto, azioni: azioniDelProgetto(progetto, documenti) }));
  const tutte = perProgetto.flatMap((p) => p.azioni);
  const piuIncarichi = progetti.length > 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...docBoxStyle, borderLeft: `4px solid ${tutte.length > 0 ? 'var(--amber)' : 'var(--green)'}` }}>
        {tutte.length > 0 ? (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>
              Tocca a te: {tutte.length === 1 ? 'una cosa da fare' : `${tutte.length} cose da fare`}
            </h2>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>Finché restano aperte, lo studio non può andare avanti su questi punti.</div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tutte.map((azione) => (
                <RigaAzione key={`${azione.progettoId}-${azione.tipo}-${azione.riferimentoId ?? ''}`} azione={azione} mostraIncarico={piuIncarichi} onApri={onApri} />
              ))}
            </ul>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>✓ Adesso non devi fare niente</h2>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
              Sta lavorando lo studio. Quando serve un tuo intervento lo trovi qui e ricevi un avviso per email.
            </div>
          </>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 14, lineHeight: 1.5 }}>
          Come si forma questo elenco: l'incarico e i documenti ancora da firmare, le richieste dello studio nelle fasi già avviate, le fasi concluse che aspettano la tua conferma, le fatture con una rata da pagare e i messaggi dello studio non ancora letti.
        </div>
      </div>

      <div style={docBoxStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 4px' }}>{piuIncarichi ? 'I tuoi incarichi' : 'Il tuo incarico'}</h2>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 14 }}>Le fasi sono nell'ordine in cui lo studio le lavora. Lo stato di ogni fase è quello registrato dallo studio.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {perProgetto.map(({ progetto, azioni }) => <SchedaIncarico key={progetto.id} progetto={progetto} azioni={azioni} onApri={onApri} />)}
        </div>
      </div>
    </div>
  );
}
