/**
 * §1ter.5 (B1-B4) — il calendario dello studio, servito dalle rotte.
 *
 * ## Che cosa c'era prima, e perché era peggio di un calendario vuoto
 *
 * La pagina costruiva il mese **da costanti scritte nel sorgente**: `Agosto 2026` come
 * intestazione, `31` come numero di giorni, `day === 14` come «oggi». Poi riempiva quella griglia
 * con eventi fabbricati sul momento — un rinnovo KYC per ogni cliente, datato `2026-08-12 + indice`,
 * una «Consegna Milestone» per ogni progetto datata `2026-08-14 + indice`, una «Scadenza Rata»
 * datata con la **data di emissione** della fattura invece che con la scadenza della rata. La
 * tabella che le sarebbe servita, `evento_calendario`, non veniva mai interrogata.
 *
 * Un calendario vuoto si nota. Quel calendario lì no: ad agosto mostrava dodici scadenze che
 * sembravano vere e cadevano in giorni che nessuna rata, nessun progetto e nessun cliente aveva mai
 * chiesto. E non erano soltanto le date: una fattura senza importo ne mostrava uno lo stesso —
 * `inv.importoTotaleCentesimi || 350000`, cioè **€ 3.500 inventati** — l'ora era sempre `10:00`,
 * `14:30` o `09:00`, il cliente senza nome diventava `'Cliente Incarico'`, e lo stato veniva da
 * `p.delay` invece che dal database. Una somma di denaro falsa accanto a un numero di fattura vero è
 * la cosa che si nota meno e costa di più. Per questo la correzione è di **verità** prima che di
 * funzionalità, e per questo le quattro cose non negoziabili qui sono:
 *
 *  1. **la griglia viene da `new Date()`**, e si naviga (B1);
 *  2. **nessun evento è fabbricato qui**: le scadenze derivate le calcola il server dalle sue
 *     sorgenti — le stesse regole del cron notturno — e quello che non esiste non compare (B2);
 *  3. **niente clienti e niente operatori inventati**: l'elenco dei clienti viene
 *     dall'anagrafica e l'assegnatario è l'uuid di una persona vera (B3);
 *  4. **l'archivio è uno**, ed è il database (B4). Le due chiavi `localStorage` — che erano due,
 *     con nomi diversi, scritte da due pagine diverse che non si incontravano mai — non esistono
 *     più, e la spunta di un compito è una `PATCH` che sopravvive al ricaricamento.
 *
 * Un evento che manca è un'informazione; un evento inventato è una bugia. E un caricamento che
 * fallisce **non** deve somigliare a un mese vuoto: per questo l'errore si vede, in testa alla
 * pagina, invece di finire in un `console.warn` come faceva prima.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchClienti } from '../api/client';
import {
  aggiornaStatoEvento,
  eliminaEventoCalendario,
  fetchEventiCalendario,
  type CategoriaCalendario,
  type EventoCalendario,
} from '../api/calendario';
import { useTeamMembers } from '../hooks/useTeamMembers';
import {
  grigliaDelMese,
  meseDi,
  oggi,
  type GiornoIso,
} from '../utils/calendarioDate';
import { Testata, type Periodo } from '../components/calendar/Testata';
import { BarraFiltri } from '../components/calendar/BarraFiltri';
import { VistaMese } from '../components/calendar/VistaMese';
import { VistaElenco } from '../components/calendar/VistaElenco';
import { ModaleDettaglio } from '../components/calendar/ModaleDettaglio';
import { ModaleNuovoEvento, type ClienteSemplice } from '../components/calendar/ModaleNuovoEvento';
import { eventiNelMese } from '../components/calendar/comune';

export function CalendarPage() {
  const { team } = useTeamMembers();

  // Il mese che si sta guardando. Inizializzato da `new Date()`, che è tutto B1.
  const [periodo, setPeriodo] = useState<Periodo>(() => meseDi(oggi()));
  const [vista, setVista] = useState<'mese' | 'lista'>('mese');
  const [filtro, setFiltro] = useState<'tutti' | CategoriaCalendario>('tutti');

  const [eventi, setEventi] = useState<EventoCalendario[]>([]);
  const [categoriePermesse, setCategoriePermesse] = useState<CategoriaCalendario[]>([]);
  const [clienti, setClienti] = useState<ClienteSemplice[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);

  const [selezionato, setSelezionato] = useState<EventoCalendario | null>(null);
  /** Il giorno da cui apre il modale di creazione: oggi, o la casella su cui si è cliccato. */
  const [bozzaAperta, setBozzaAperta] = useState<{ giorno: GiornoIso } | null>(null);

  const caselle = useMemo(() => grigliaDelMese(periodo.anno, periodo.mese), [periodo]);

  /**
   * La finestra chiesta al server: le caselle **disegnate**, non i giorni del mese.
   *
   * La griglia sborda di qualche giorno nel mese precedente e nel successivo per restare un
   * rettangolo di settimane intere. Chiedere solo il mese lascerebbe quelle caselle
   * sistematicamente vuote — non perché non c'è niente, ma perché non è stato chiesto: un vuoto che
   * sembra un dato e non lo è, cioè esattamente il difetto che questa pagina sta correggendo.
   */
  const intervallo = useMemo(
    () => ({ da: caselle[0].giorno, a: caselle[caselle.length - 1].giorno }),
    [caselle],
  );

  const carica = useCallback(async () => {
    setCaricamento(true);
    try {
      const griglia = await fetchEventiCalendario(intervallo);
      setEventi(griglia.eventi);
      setCategoriePermesse(griglia.categorie);
      setErrore(null);
    } catch (err: any) {
      // L'errore si vede. Prima finiva in un `console.warn` e la pagina mostrava il mese vuoto:
      // «non ci sono scadenze» e «non sono riuscito a leggerle» diventavano la stessa schermata.
      setEventi([]);
      setErrore(err?.message || 'Lettura del calendario non riuscita.');
    } finally {
      setCaricamento(false);
    }
  }, [intervallo]);

  useEffect(() => {
    void carica();
  }, [carica]);

  /**
   * L'anagrafica dei clienti, per il modulo di creazione (B3).
   *
   * Una volta sola, e l'errore non è fatale: se l'anagrafica non risponde, il modulo resta senza
   * elenco — e lo dice — invece di impedire di scrivere un promemoria che di clienti non ha bisogno.
   */
  useEffect(() => {
    let annullato = false;
    void (async () => {
      try {
        const risposta = await fetchClienti();
        if (annullato || !Array.isArray(risposta)) return;
        setClienti(
          risposta
            .filter((c: any) => typeof c?.id === 'string' && typeof c?.nome === 'string')
            .map((c: any) => ({ id: c.id as string, nome: c.nome as string })),
        );
      } catch {
        // Silenzio deliberato: l'elenco vuoto è già un'informazione, e il modale la mostra.
      }
    })();
    return () => { annullato = true; };
  }, []);

  /**
   * Se il filtro scelto non è più fra le categorie consentite, si torna a «tutti».
   *
   * Succede quando i permessi cambiano mentre la pagina è aperta — un amministratore toglie lo
   * scadenzario a un collaboratore — e senza questo la pagina resterebbe con un filtro selezionato
   * che non può più restituire niente.
   */
  useEffect(() => {
    if (filtro !== 'tutti' && !categoriePermesse.includes(filtro)) setFiltro('tutti');
  }, [categoriePermesse, filtro]);

  const visibili = useMemo(
    () => (filtro === 'tutti' ? eventi : eventi.filter((e) => e.categoria === filtro)),
    [eventi, filtro],
  );

  const inElenco = useMemo(
    () => eventiNelMese(visibili, periodo.anno, periodo.mese),
    [visibili, periodo],
  );

  const oggiIso = oggi();
  const nelMeseCorrente = intervallo.da <= oggiIso && oggiIso <= intervallo.a;

  /**
   * Cambia lo stato di un evento e rilegge la griglia.
   *
   * L'aggiornamento locale serve solo a non far aspettare il clic; la rilettura è l'unica fonte,
   * perché è quella che sopravvive al ricaricamento — e la spunta che non sopravviveva era
   * esattamente il difetto di prima.
   */
  const cambiaStato = useCallback(async (evento: EventoCalendario) => {
    const nuovo: 'da_fare' | 'fatto' = evento.stato === 'fatto' ? 'da_fare' : 'fatto';
    setEventi((precedenti) => precedenti.map((e) => (e.id === evento.id ? { ...e, stato: nuovo } : e)));
    setSelezionato((s) => (s && s.id === evento.id ? { ...s, stato: nuovo } : s));
    try {
      await aggiornaStatoEvento(evento.id, nuovo);
      setErrore(null);
    } catch (err: any) {
      setErrore(err?.message || 'Il cambio di stato non è stato registrato.');
    }
    await carica();
  }, [carica]);

  const cancella = useCallback(async (evento: EventoCalendario) => {
    try {
      await eliminaEventoCalendario(evento.id);
      setSelezionato(null);
      await carica();
    } catch (err: any) {
      setErrore(err?.message || 'Cancellazione non riuscita.');
    }
  }, [carica]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Testata
        periodo={periodo}
        setPeriodo={setPeriodo}
        vista={vista}
        setVista={setVista}
        nelMeseCorrente={nelMeseCorrente}
        onOggi={() => setPeriodo(meseDi(oggiIso))}
        onRicarica={carica}
        onNuovo={() => setBozzaAperta({ giorno: oggiIso })}
      />

      {errore && (
        <div
          role="alert"
          style={{ background: '#450a0a', border: '1px solid #b91c1c', color: '#fecaca', padding: '12px 16px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}
        >
          ⚠️ {errore} — quello che vedi qui sotto può essere incompleto.
        </div>
      )}

      <BarraFiltri
        filtro={filtro}
        setFiltro={setFiltro}
        categoriePermesse={categoriePermesse}
        totale={visibili.length}
      />

      {caricamento ? (
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
          Lettura delle scadenze in corso…
        </div>
      ) : vista === 'mese' ? (
        <VistaMese
          caselle={caselle}
          eventi={visibili}
          oggiIso={oggiIso}
          onApri={setSelezionato}
          onCrea={(giorno) => setBozzaAperta({ giorno })}
        />
      ) : (
        <VistaElenco eventi={inElenco} onApri={setSelezionato} onCambiaStato={cambiaStato} />
      )}

      {selezionato && (
        <ModaleDettaglio
          evento={selezionato}
          onChiudi={() => setSelezionato(null)}
          onCambiaStato={cambiaStato}
          onCancella={cancella}
        />
      )}

      {bozzaAperta && (
        <ModaleNuovoEvento
          giornoIniziale={bozzaAperta.giorno}
          clienti={clienti}
          team={team}
          onChiudi={() => setBozzaAperta(null)}
          onCreato={carica}
        />
      )}
    </div>
  );
}
