// La pagina personale del cliente nel portale: a che punto è ogni incarico, e cosa tocca a lui.
//
// Funzione pura: riceve ciò che la rotta ha già letto dal database e non emette query. Stati e
// percentuali delle fasi sono quelli di `calcolaAvanzamento` (§16): qui non si ricalcola niente,
// si decide solo cosa dire al cliente e in che ordine.
//
// Cosa conta come «tocca a te» (ogni voce si spiega in una frase, ed è quella che il portale mostra):
//  - la lettera d'incarico non ancora firmata;
//  - una richiesta dello studio (passaggio «a carico del cliente») non ancora evasa, in una fase avviata;
//  - una fase conclusa dallo studio che aspetta la conferma del cliente;
//  - una fattura con una rata da pagare;
//  - messaggi dello studio non ancora letti.
// I documenti da firmare li aggiunge il portale dall'elenco di `GET /portal/documenti`, che è
// l'unico punto in cui il server decide se un documento va firmato: rifare qui quella regola
// vorrebbe dire averne due.
import { calcolaAvanzamento, type MicrovoceCalcolo } from './calcoloService.js';

export type FaseCliente = 'da_iniziare' | 'in_attesa' | 'in_corso' | 'completato';
export type StatoRichiesta = 'da_fare' | 'inviata' | 'chiusa';
export type TipoAzione = 'firma_incarico' | 'richiesta' | 'conferma_fase' | 'fattura' | 'messaggi';
/** La scheda del portale in cui l'azione si compie. */
export type SchedaAzione = 'proposta' | 'richieste' | 'avanzamento' | 'fatture' | 'contatti';

export interface PassaggioLetto {
  id: string;
  titolo: string;
  tipo: string;
  chi: string;
  stato: string;
  ordine: number;
  descrizione: string | null;
  campiFormJson: unknown;
  risposteFormJson: unknown;
  risposteClienteJson: unknown;
  rispostaClienteAt: Date | null;
  documentoAllegatoUrl: string | null;
  linkIstruzioni: string | null;
}

export interface MicrovoceLetta extends MicrovoceCalcolo {
  nome: string;
  ordine: number;
  passaggi: PassaggioLetto[];
}

export interface ModuloLetto {
  id: string;
  nome: string;
  categoria: string;
  stato: string;
  orePreventivate: number;
  microvoci: MicrovoceLetta[];
  microvociCondivise?: { microvoceProgetto: MicrovoceCalcolo }[];
  dipendenze: { dipendeDaModuloProgettoId: string }[];
}

export interface ProgettoLetto {
  id: string;
  nome: string;
  stato: string;
  numeroContratto: string | null;
  moduli: ModuloLetto[];
}

export interface FatturaDaPagare {
  id: string;
  numero: string;
  progettoId: string;
  dataScadenza: Date;
  importoCentesimi: number;
  scaduta: boolean;
}

export interface ContestoRiepilogo {
  /** Id dei progetti con la lettera d'incarico firmata. */
  lettereFirmate: Set<string>;
  /** Id delle fasi (moduli) di cui il cliente ha già confermato la conclusione. */
  fasiConfermate: Set<string>;
  /** Progetto → messaggi dello studio non ancora letti. */
  messaggiNonLetti: Map<string, number>;
  fattureDaPagare: FatturaDaPagare[];
  /** Rinnova la firma di un indirizzo dell'archivio (scade dopo qualche giorno). */
  indirizzoFile: (url: string) => string;
}

export interface CampoRichiesta {
  nome: string;
  /** Il valore da proporre: la risposta già data, oppure quella data altrove per lo stesso campo. */
  valore: string | null;
  /** Vero quando `valore` viene da un'altra richiesta: il cliente lo conferma o lo corregge. */
  ripreso: boolean;
}

export interface RichiestaCliente {
  id: string;
  progettoId: string;
  faseId: string;
  faseNome: string;
  attivitaId: string;
  attivitaNome: string;
  titolo: string;
  descrizione: string | null;
  tipo: 'form' | 'documento' | 'info' | 'verifica';
  campi: CampoRichiesta[];
  /** Il documento che lo studio ha allegato alla richiesta (per esempio il modulo da compilare). */
  modelloUrl: string | null;
  linkIstruzioni: string | null;
  stato: StatoRichiesta;
  /** `piu_avanti`: la fase non è ancora partita; si può già rispondere, ma non è urgente. */
  quando: 'ora' | 'piu_avanti';
  inviataIl: string | null;
}

export interface AzioneCliente {
  tipo: TipoAzione;
  titolo: string;
  dettaglio: string;
  scheda: SchedaAzione;
  riferimentoId: string | null;
  urgente: boolean;
  /** Solo per le fatture: la rata da pagare, in centesimi, e la sua scadenza. Li formatta il portale. */
  importoCentesimi?: number;
  scadenza?: string;
}

export interface FaseRiepilogo {
  id: string;
  nome: string;
  categoria: string;
  fase: FaseCliente;
  percentuale: number;
  attivitaTotali: number;
  attivitaConcluse: number;
  /** Nomi delle fasi che devono concludersi prima che questa parta. */
  attende: string[];
  richiesteDaFare: number;
  /** Conclusa dallo studio e in attesa della conferma del cliente. */
  daConfermare: boolean;
  confermata: boolean;
}

export interface RiepilogoProgetto {
  id: string;
  nome: string;
  numeroContratto: string | null;
  stato: string;
  percentuale: number;
  /** Chi deve muoversi adesso, per ciò che il server sa (i documenti da firmare li aggiunge il portale). */
  turno: 'cliente' | 'studio' | 'concluso';
  letteraFirmata: boolean;
  fasi: FaseRiepilogo[];
  azioni: AzioneCliente[];
  richieste: RichiestaCliente[];
}

/** Lo stato calcolato di un modulo, detto come lo legge il cliente (stessa regola di `faseModulo.ts`). */
export function faseDelCliente(stato: string): FaseCliente {
  if (stato === 'done') return 'completato';
  if (stato === 'pending') return 'da_iniziare';
  if (stato === 'attesa_dipendenza') return 'in_attesa';
  // «In ritardo» e «bloccato» il cliente li vede come «in corso»: mostrargli il ritardo è una
  // scelta dello studio che nessuno ha ancora preso.
  return 'in_corso';
}

function elencoStringhe(valore: unknown): string[] {
  return Array.isArray(valore) ? valore.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];
}

function mappaStringhe(valore: unknown): Record<string, string> {
  if (!valore || typeof valore !== 'object' || Array.isArray(valore)) return {};
  const uscita: Record<string, string> = {};
  for (const [chiave, v] of Object.entries(valore as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim() !== '') uscita[chiave] = v;
  }
  return uscita;
}

const chiaveCampo = (nome: string) => nome.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Le risposte che il cliente (o lo studio per lui) ha già dato, per nome del campo: servono a non
 * chiedergli due volte la stessa cosa. Vale la risposta registrata dallo studio, perché è quella
 * verificata; in mancanza, l'ultima scritta dal cliente.
 */
export function risposteGiaDate(progetti: ProgettoLetto[]): Map<string, string> {
  const delloStudio = new Map<string, string>();
  const delCliente = new Map<string, { valore: string; quando: number }>();
  for (const progetto of progetti) {
    for (const modulo of progetto.moduli) {
      for (const microvoce of modulo.microvoci) {
        for (const passaggio of microvoce.passaggi) {
          for (const [campo, valore] of Object.entries(mappaStringhe(passaggio.risposteFormJson))) {
            delloStudio.set(chiaveCampo(campo), valore);
          }
          const quando = passaggio.rispostaClienteAt?.getTime() ?? 0;
          for (const [campo, valore] of Object.entries(mappaStringhe(passaggio.risposteClienteJson))) {
            const chiave = chiaveCampo(campo);
            const precedente = delCliente.get(chiave);
            if (!precedente || quando >= precedente.quando) delCliente.set(chiave, { valore, quando });
          }
        }
      }
    }
  }
  const uscita = new Map<string, string>();
  for (const [chiave, { valore }] of delCliente) uscita.set(chiave, valore);
  for (const [chiave, valore] of delloStudio) uscita.set(chiave, valore);
  return uscita;
}

function tipoRichiesta(tipo: string): RichiestaCliente['tipo'] {
  return tipo === 'form' || tipo === 'documento' || tipo === 'info' ? tipo : 'verifica';
}

/** Mette prima le fasi da cui le altre dipendono, lasciando il resto nell'ordine in cui è arrivato. */
function inOrdineDiLavoro<T extends { id: string; dipendenze: { dipendeDaModuloProgettoId: string }[] }>(moduli: T[]): T[] {
  const ordinati: T[] = [];
  const messi = new Set<string>();
  const presenti = new Set(moduli.map((m) => m.id));
  let rimasti = [...moduli];
  while (rimasti.length > 0) {
    const pronti = rimasti.filter((m) => m.dipendenze.every((d) => messi.has(d.dipendeDaModuloProgettoId) || !presenti.has(d.dipendeDaModuloProgettoId)));
    // Un giro di dipendenze non dovrebbe esistere; se c'è, il resto esce com'è invece di girare a vuoto.
    const daMettere = pronti.length > 0 ? pronti : rimasti;
    for (const m of daMettere) { ordinati.push(m); messi.add(m.id); }
    rimasti = rimasti.filter((m) => !messi.has(m.id));
  }
  return ordinati;
}

export function riepilogoProgetto(progetto: ProgettoLetto, contesto: ContestoRiepilogo, giaDate: Map<string, string>): RiepilogoProgetto {
  const avanzamento = calcolaAvanzamento(progetto);
  const calcolati = new Map(avanzamento.moduli.map((m) => [m.id, m]));
  const nomi = new Map(progetto.moduli.map((m) => [m.id, m.nome]));
  const concluso = avanzamento.stato === 'completed' || progetto.stato === 'archived';
  const letteraFirmata = contesto.lettereFirmate.has(progetto.id);

  const richieste: RichiestaCliente[] = [];
  const fasi: FaseRiepilogo[] = inOrdineDiLavoro(progetto.moduli).map((modulo) => {
    const calcolato = calcolati.get(modulo.id);
    const statoModulo = calcolato?.stato ?? modulo.stato;
    const fase = faseDelCliente(statoModulo);
    let richiesteDaFare = 0;
    for (const microvoce of [...modulo.microvoci].sort((a, b) => a.ordine - b.ordine)) {
      const piuAvanti = fase === 'in_attesa' || microvoce.stato === 'attesa_dipendenza';
      for (const passaggio of [...microvoce.passaggi].sort((a, b) => a.ordine - b.ordine)) {
        if (passaggio.chi !== 'cliente') continue;
        const risposte = mappaStringhe(passaggio.risposteClienteJson);
        const registrate = mappaStringhe(passaggio.risposteFormJson);
        const stato: StatoRichiesta = passaggio.stato === 'done' ? 'chiusa' : passaggio.rispostaClienteAt ? 'inviata' : 'da_fare';
        const campi = elencoStringhe(passaggio.campiFormJson).map((nome): CampoRichiesta => {
          const propria = risposte[nome] ?? registrate[nome];
          if (propria !== undefined) return { nome, valore: propria, ripreso: false };
          const altrove = giaDate.get(chiaveCampo(nome));
          return { nome, valore: altrove ?? null, ripreso: altrove !== undefined };
        });
        const quando = piuAvanti ? 'piu_avanti' : 'ora';
        if (stato === 'da_fare' && quando === 'ora') richiesteDaFare += 1;
        richieste.push({
          id: passaggio.id,
          progettoId: progetto.id,
          faseId: modulo.id,
          faseNome: modulo.nome,
          attivitaId: microvoce.id,
          attivitaNome: microvoce.nome,
          titolo: passaggio.titolo,
          descrizione: passaggio.descrizione,
          tipo: tipoRichiesta(passaggio.tipo),
          campi,
          modelloUrl: passaggio.documentoAllegatoUrl ? contesto.indirizzoFile(passaggio.documentoAllegatoUrl) : null,
          linkIstruzioni: passaggio.linkIstruzioni,
          stato,
          quando,
          inviataIl: passaggio.rispostaClienteAt ? passaggio.rispostaClienteAt.toISOString() : null,
        });
      }
    }
    const confermata = contesto.fasiConfermate.has(modulo.id);
    return {
      id: modulo.id,
      nome: modulo.nome,
      categoria: modulo.categoria,
      fase,
      percentuale: calcolato?.percentuale ?? 0,
      attivitaTotali: modulo.microvoci.length,
      attivitaConcluse: modulo.microvoci.filter((mv) => mv.stato === 'done').length,
      attende: fase === 'in_attesa'
        ? modulo.dipendenze
            .filter((d) => calcolati.get(d.dipendeDaModuloProgettoId)?.stato !== 'done')
            .map((d) => nomi.get(d.dipendeDaModuloProgettoId))
            .filter((n): n is string => Boolean(n))
        : [],
      richiesteDaFare,
      daConfermare: fase === 'completato' && !confermata,
      confermata,
    };
  });

  const azioni: AzioneCliente[] = [];
  if (!letteraFirmata && !concluso) {
    azioni.push({
      tipo: 'firma_incarico',
      titolo: 'Firma la lettera d’incarico',
      dettaglio: 'Lo studio avvia i lavori quando l’incarico è firmato.',
      scheda: 'proposta',
      riferimentoId: progetto.id,
      urgente: true,
    });
  }
  for (const fattura of contesto.fattureDaPagare.filter((f) => f.progettoId === progetto.id && f.scaduta)) {
    azioni.push({
      tipo: 'fattura',
      titolo: `Fattura ${fattura.numero} scaduta`,
      dettaglio: 'La scadenza della rata è passata. Se hai già pagato, lo studio la segna incassata appena registra il pagamento.',
      scheda: 'fatture',
      riferimentoId: fattura.id,
      urgente: true,
      importoCentesimi: fattura.importoCentesimi,
      scadenza: fattura.dataScadenza.toISOString(),
    });
  }
  for (const richiesta of richieste.filter((r) => r.stato === 'da_fare' && r.quando === 'ora')) {
    azioni.push({
      tipo: 'richiesta',
      titolo: richiesta.titolo,
      dettaglio: `Richiesto dallo studio per la fase «${richiesta.faseNome}».`,
      scheda: 'richieste',
      riferimentoId: richiesta.id,
      urgente: false,
    });
  }
  for (const fase of fasi.filter((f) => f.daConfermare)) {
    azioni.push({
      tipo: 'conferma_fase',
      titolo: `Conferma la conclusione di «${fase.nome}»`,
      dettaglio: 'Lo studio ha concluso le attività di questa fase: controlla e firma la conferma.',
      scheda: 'avanzamento',
      riferimentoId: fase.id,
      urgente: false,
    });
  }
  for (const fattura of contesto.fattureDaPagare.filter((f) => f.progettoId === progetto.id && !f.scaduta)) {
    azioni.push({
      tipo: 'fattura',
      titolo: `Fattura ${fattura.numero} da pagare`,
      dettaglio: 'C’è una rata non ancora pagata.',
      scheda: 'fatture',
      riferimentoId: fattura.id,
      urgente: false,
      importoCentesimi: fattura.importoCentesimi,
      scadenza: fattura.dataScadenza.toISOString(),
    });
  }
  const nonLetti = contesto.messaggiNonLetti.get(progetto.id) ?? 0;
  if (nonLetti > 0) {
    azioni.push({
      tipo: 'messaggi',
      titolo: nonLetti === 1 ? 'Un messaggio dello studio da leggere' : `${nonLetti} messaggi dello studio da leggere`,
      dettaglio: 'Lo trovi nel canale protetto, alla scheda Messaggi.',
      scheda: 'contatti',
      riferimentoId: null,
      urgente: false,
    });
  }

  return {
    id: progetto.id,
    nome: progetto.nome,
    numeroContratto: progetto.numeroContratto,
    stato: avanzamento.stato,
    percentuale: avanzamento.percentuale,
    turno: azioni.length > 0 ? 'cliente' : concluso ? 'concluso' : 'studio',
    letteraFirmata,
    fasi,
    azioni,
    richieste,
  };
}

export function riepilogoCliente(progetti: ProgettoLetto[], contesto: ContestoRiepilogo): RiepilogoProgetto[] {
  const giaDate = risposteGiaDate(progetti);
  return progetti.map((progetto) => riepilogoProgetto(progetto, contesto, giaDate));
}

/**
 * Controlla le risposte che il cliente manda a una richiesta: solo i campi che lo studio ha
 * chiesto, tutti compilati, entro una lunghezza ragionevole. Restituisce le risposte pulite o,
 * in italiano, il motivo del rifiuto.
 */
export function controllaRisposte(campiFormJson: unknown, risposte: unknown): { ok: true; risposte: Record<string, string> } | { ok: false; errore: string } {
  const campi = elencoStringhe(campiFormJson);
  const ricevute = risposte && typeof risposte === 'object' && !Array.isArray(risposte) ? (risposte as Record<string, unknown>) : {};
  const pulite: Record<string, string> = {};
  for (const campo of campi) {
    const valore = ricevute[campo];
    const testo = typeof valore === 'string' ? valore.trim() : '';
    if (!testo) return { ok: false, errore: `Manca la risposta a «${campo}».` };
    if (testo.length > 2000) return { ok: false, errore: `La risposta a «${campo}» supera i 2000 caratteri.` };
    pulite[campo] = testo;
  }
  const estranei = Object.keys(ricevute).filter((chiave) => !campi.includes(chiave));
  if (estranei.length > 0) return { ok: false, errore: `«${estranei[0]}» non è tra i campi richiesti.` };
  return { ok: true, risposte: pulite };
}
