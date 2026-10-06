import { useEffect, useRef, useState } from 'react';
import {
  inviaComunicazioneApi,
  sendEmailDirectApi,
  sendSignalDirectApi,
  sendTelegramDirectApi,
  sendWhatsAppDirectApi,
  uploadFileApi,
} from '../api/client';
import type { RecapitiCliente } from '../utils/recapitiCliente';

/**
 * L'invio di un messaggio del fascicolo: **una** implementazione, due punti di montaggio.
 *
 * Perché è un hook e non due moduli. Fino al 06/10/2026 l'invio viveva dentro
 * `ComunicazioniTab.handleInviaMessaggio`, ~225 righe che facevano upload, scrittura, dispatch e
 * aggiornamento dell'esito. Il compositore della micro-voce avrebbe dovuto **ricopiarlo**, e due
 * copie della stessa procedura sono due verità su una cosa sola: è esattamente il guasto che
 * `SpunteStato.tsx` racconta (sei messaggi rifiutati da Meta per mesi, con le spunte blu disegnate,
 * perché il ternario che le disegnava era stato copiato in due file e nessuno dei due sapeva
 * dell'esito vero). Qui la consegna si chiede in un posto solo, e chi monta il compositore decide
 * soltanto dove far comparire la riga.
 *
 * L'ordine delle operazioni è quello di prima, e non è arbitrario:
 *
 *   1. l'allegato si carica **prima**, perché senza il suo URL la riga non può portarlo;
 *   2. la riga nasce sul server **prima** che il canale venga contattato — se il dispatch
 *      fallisse dopo, il fascicolo conserva il messaggio e il motivo del rifiuto, che è la
 *      differenza fra «non è partito» e «non esiste»;
 *   3. l'esito del dispatch torna al chiamante (`onEsito`) perché la riga appena spedita lo mostri
 *      subito, invece di restare «in attesa» fino al prossimo caricamento del fascicolo.
 *
 * Nessun recapito si inventa: se l'anagrafica non ha il numero o l'indirizzo del canale scelto,
 * l'invio si ferma **prima** di scrivere, e dice cosa manca. Qui c'erano un'email, un cellulare e un
 * handle Telegram scritti nel codice: quando l'anagrafica era incompleta il messaggio partiva verso
 * persone estranee al fascicolo e l'interfaccia annunciava «recapitato con successo».
 */

export type CanaleInvio = 'email' | 'whatsapp' | 'telegram' | 'signal' | 'portal';

export interface AllegatoInviato {
  nome: string;
  url: string;
  dimensione: string;
  mime: string;
}

/**
 * La riga ottimistica che il compositore consegna a chi lo monta.
 *
 * Non è il tipo del fascicolo: il chiamante decide come mostrarla. Il campo `id` è **locale**
 * (`msg-<timestamp>`), ed è la chiave con cui `onEsito` ritrova la riga da aggiornare.
 */
export interface MessaggioInviato {
  id: string;
  canale: CanaleInvio;
  mittente: string;
  destinatario: string;
  direzione: 'uscita';
  testo: string;
  dataOra: string;
  allegati: AllegatoInviato[];
  stato: 'consegnato' | 'da-inviare';
}

export interface EsitoInvio {
  stato: 'inviato' | 'non-inviato';
  errore?: string;
}

export interface ParametriInvio {
  progettoId: string;
  nomeCliente?: string;
  /** L'email dell'anagrafica della pratica, terza dopo quella del cliente e quella digitata. */
  emailCliente?: string;
  contatto: RecapitiCliente;
  /**
   * La micro-voce da cui si sta scrivendo, quando c'è.
   *
   * È ciò che fa nascere il messaggio **già abbinato**: il server registra `origine: 'microvoce'`,
   * che non è `manuale` — nessuno ha abbinato niente a mano — né `contesto`, che parla della chat e
   * non di questo messaggio.
   */
  microvoceProgettoId?: string;
  canalePredefinito?: CanaleInvio;
  /**
   * Dove mostrare il riscontro dell'invio.
   *
   * Non è uno stato dell'hook di proposito: chi monta il compositore ha **già** un riscontro suo —
   * la sincronizzazione della posta, l'esito di un abbinamento — e due stati separati darebbero due
   * riquadri accesi insieme, che è peggio di un riscontro solo. Il compositore lo disegna, ma è del
   * chiamante.
   */
  onFeedback?: (f: { tipo: 'ok' | 'err'; testo: string } | null) => void;
  /** La riga è stata creata: il chiamante la mostra dove vuole. */
  onInviato?: (messaggio: MessaggioInviato) => void;
  /**
   * La riga **esiste sul server**. Diverso da `onInviato`, e la differenza è l'ordine: `onInviato`
   * scatta subito, con la riga ottimistica, prima ancora di chiedere la scrittura — chi mostra la
   * bolla nell'elenco vuole quella, ed è giusto che sia istantanea. Chi invece deve **rileggere** dal
   * server (la scheda della micro-voce, dove la card porta l'origine registrata a backend) deve
   * aspettare questo: rileggere su `onInviato` chiederebbe l'elenco prima che la riga ci sia, e la
   * card appena scritta non comparirebbe.
   */
  onRegistrato?: (idLocale: string) => void;
  /** Com'è andata la consegna, per la riga con quell'id locale. */
  onEsito?: (idLocale: string, esito: EsitoInvio) => void;
}

export interface InvioComunicazione {
  canale: CanaleInvio;
  setCanale: (c: CanaleInvio) => void;
  testo: string;
  setTesto: (t: string) => void;
  fileAllegato: { nome: string; base64: string; sizeStr: string; mime: string } | null;
  setFileAllegato: (f: { nome: string; base64: string; sizeStr: string; mime: string } | null) => void;
  /**
   * Il campo file nascosto, che il tasto 📎 apre.
   *
   * `| null` non è pignoleria: da React 19 `useRef<T>(null)` restituisce `RefObject<T | null>`, e il
   * componente che lo monta lo assegna a `ref`, che accetta esattamente quella forma.
   */
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  customDestEmail: string;
  setCustomDestEmail: (v: string) => void;
  inviando: boolean;
  caricandoFile: boolean;
  /** Il click su «Invia»: si occupa di tutto, e non lancia. */
  invia: (e: React.FormEvent) => Promise<void>;
}

/** L'utente che ha fatto l'accesso, per firmare il messaggio. Vuoto quando non si sa. */
function mittenteCorrente(): string {
  const grezzo = typeof window !== 'undefined' ? localStorage.getItem('bluman_user') : null;
  if (!grezzo) return 'Studio';
  try {
    const utente = JSON.parse(grezzo);
    if (utente?.nome) return `${utente.nome}${utente.email ? ` (${utente.email})` : ''}`;
    return utente?.email || 'Studio';
  } catch {
    return 'Studio';
  }
}

export function useInvioComunicazione(parametri: ParametriInvio): InvioComunicazione {
  const {
    progettoId, nomeCliente, emailCliente, contatto, microvoceProgettoId, canalePredefinito,
    onFeedback, onInviato, onRegistrato, onEsito,
  } = parametri;

  const [canale, setCanale] = useState<CanaleInvio>(canalePredefinito ?? 'whatsapp');
  /**
   * L'operatore ha scelto il canale a mano: da lì in poi il predefinito non comanda più.
   *
   * Serve perché il predefinito della micro-voce **arriva dopo**: è il canale dell'ultimo messaggio
   * di quella voce, che si legge dal server mentre il modale è già aperto. Senza questa riga il
   * selettore tornerebbe da solo sul canale dell'ultimo messaggio un istante dopo che l'operatore lo
   * ha cambiato — cioè sceglierebbe il server al posto suo.
   */
  const sceltaManuale = useRef(false);
  const sceglieCanale = (c: CanaleInvio) => { sceltaManuale.current = true; setCanale(c); };
  useEffect(() => {
    if (!sceltaManuale.current && canalePredefinito) setCanale(canalePredefinito);
  }, [canalePredefinito]);
  const [testo, setTesto] = useState('');
  const [customDestEmail, setCustomDestEmail] = useState('');
  const [inviando, setInviando] = useState(false);
  const [caricandoFile, setCaricandoFile] = useState(false);
  const [fileAllegato, setFileAllegato] = useState<{ nome: string; base64: string; sizeStr: string; mime: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const avvisa = (f: { tipo: 'ok' | 'err'; testo: string } | null) => onFeedback?.(f);

  /**
   * Il destinatario come lo si mostra e come lo legge il canale.
   *
   * `email` è l'unico canale in cui l'operatore può correggere a mano: gli altri recapiti sono presi
   * dall'anagrafica e non si improvvisano — un numero indovinato è un messaggio a una persona
   * estranea al fascicolo.
   */
  const destinatarioPer = (c: CanaleInvio): string => {
    switch (c) {
      case 'whatsapp': return `${contatto.referente} (${contatto.whatsapp})`;
      case 'email': return customDestEmail.trim() || contatto.email;
      case 'telegram': return `${contatto.telegram} (${contatto.referente})`;
      case 'signal': return `${contatto.referente} (${contatto.signal})`;
      case 'portal': return contatto.referente || nomeCliente || '';
      default: return `Cliente (${nomeCliente || ''})`;
    }
  };

  const invia = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!testo.trim() && !fileAllegato) || inviando || caricandoFile) return;
    setInviando(true);
    avvisa(null);

    let allegatiCaricati: AllegatoInviato[] | undefined;
    if (fileAllegato) {
      setCaricandoFile(true);
      try {
        const resUpload = await uploadFileApi(fileAllegato.nome, fileAllegato.base64);
        if (resUpload && resUpload.url) {
          allegatiCaricati = [{
            nome: resUpload.name || fileAllegato.nome,
            url: resUpload.url,
            dimensione: resUpload.size || fileAllegato.sizeStr,
            mime: fileAllegato.mime,
          }];
        }
      } catch (errUp) {
        console.warn('Errore upload allegato:', errUp);
        // L'allegato non è una condizione dell'invio: si prosegue senza, e il messaggio resta.
      } finally {
        setCaricandoFile(false);
      }
    }

    const testoDaInviare = testo.trim() || (allegatiCaricati ? `[Allegato: ${allegatiCaricati[0].nome}]` : '');
    const mittente = mittenteCorrente();
    const destinatario = destinatarioPer(canale);

    const nuovoMsg: MessaggioInviato = {
      id: `msg-${Date.now()}`,
      canale,
      mittente,
      destinatario,
      direzione: 'uscita',
      testo: testoDaInviare,
      dataOra: new Date().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      allegati: allegatiCaricati || [],
      // Il portale è l'unico canale che non ha un passo di consegna dopo la scrittura: il messaggio
      // è «arrivato» nell'istante in cui compare nel portale del cliente. Per tutti gli altri la
      // riga nasce in attesa, ed è il dispatch a dire com'è finita.
      stato: canale === 'portal' ? 'consegnato' : 'da-inviare',
    };

    onInviato?.(nuovoMsg);
    setTesto('');
    setFileAllegato(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    let esitoInvio: EsitoInvio | null = null;

    try {
      // 1. Persistenza: la riga nasce sul fascicolo **prima** che il canale sia contattato. Con
      //    `microvoceProgettoId` nasce anche legata alla micro-voce, nella stessa transazione.
      const riga = await inviaComunicazioneApi(progettoId, {
        canale,
        mittente,
        destinatario,
        direzione: 'uscita',
        testo: testoDaInviare,
        ...(allegatiCaricati ? { allegatiJson: allegatiCaricati } : {}),
        ...(microvoceProgettoId ? { microvoceProgettoId } : {}),
      });

      // L'id della riga appena creata accompagna ogni dispatch: è ciò che permette al backend di
      // annotare sul fascicolo com'è andata, invece di lasciarlo per sempre in attesa.
      const comunicazioneId: string | undefined = riga?.id ? String(riga.id) : undefined;

      // Da qui la riga si può rileggere: chi tiene un elenco che arriva dal server lo ricarica ora.
      onRegistrato?.(nuovoMsg.id);

      if (canale === 'email') {
        // Qui il ripiego era la casella dello studio: senza email in anagrafica il messaggio
        // destinato al cliente arrivava allo studio stesso, e il riscontro diceva «recapitata con
        // successo alla casella support@...». Meglio fermarsi e dirlo.
        const destEmail = (customDestEmail || contatto.email || emailCliente || '').trim();
        if (!destEmail) {
          avvisa({ tipo: 'err', testo: `Nessuna email per ${nomeCliente || 'il cliente'}: scrivila nel campo destinatario o compila l'anagrafica.` });
          return;
        }
        const res = await sendEmailDirectApi(
          destEmail,
          `💬 Comunicazione Studio BlueCode Advisory — Fascicolo ${nomeCliente || 'Pratica'}`,
          testoDaInviare,
          undefined,
          comunicazioneId,
        );
        if (res && res.success) {
          esitoInvio = { stato: 'inviato' };
          avvisa({ tipo: 'ok', testo: `✓ Email recapitata con successo alla casella ${destEmail}!` });
        } else {
          esitoInvio = { stato: 'non-inviato', errore: res?.errore };
          avvisa({ tipo: 'err', testo: `❌ Errore Invio Email: ${res?.errore || 'Verifica la password SMTP in Impostazioni'}` });
        }
      } else if (canale === 'whatsapp') {
        // Il numero era `|| '<un numero scritto nel codice>'`: senza cellulare in anagrafica il
        // messaggio partiva verso il telefono personale del titolare. E quando l'invio falliva, il
        // ripiego spediva il template di esempio `hello_world` e annunciava «Notifica consegnata»:
        // al destinatario arrivava «Hello World», all'operatore un successo.
        const cleanPhone = (contatto.whatsapp || '').replace(/\D/g, '');
        if (!cleanPhone) {
          avvisa({ tipo: 'err', testo: `Nessun cellulare in anagrafica per ${nomeCliente || 'il cliente'}: WhatsApp non può partire.` });
          return;
        }
        const res = await sendWhatsAppDirectApi(cleanPhone, testoDaInviare, undefined, comunicazioneId);
        if (res && res.success) {
          esitoInvio = { stato: 'inviato' };
          // «Accettato da Meta», non «recapitato»: la consegna al telefono la conferma il webhook di
          // stato, ed è quello che fa comparire le due spunte. Qui Meta ha solo preso in carico.
          avvisa({ tipo: 'ok', testo: `✓ WhatsApp ha accettato il messaggio per ${contatto.whatsapp}: la consegna al telefono arriva dopo.` });
        } else {
          esitoInvio = { stato: 'non-inviato', errore: res?.errore };
          avvisa({ tipo: 'err', testo: `WhatsApp non ha accettato l'invio verso ${contatto.whatsapp}: ${res?.errore || 'motivo non riportato'}. Il messaggio resta nel registro del fascicolo.` });
        }
      } else if (canale === 'signal') {
        // Questo ramo non c'era, e la sua assenza era il difetto peggiore della chat: Signal era una
        // voce dell'elenco e sceglierlo faceva cadere il flusso nell'`else` finale, che rispondeva
        // «Messaggio registrato e notificato via SIGNAL al cliente!». Nessun demone veniva
        // contattato: il cliente non riceveva niente e l'operatore credeva di sì.
        const destSignal = (contatto.signal || '').trim();
        if (!destSignal) {
          avvisa({ tipo: 'err', testo: `Nessun numero Signal per ${nomeCliente || 'il cliente'}: indicane uno in forma internazionale fra i referenti dell'anagrafica.` });
          return;
        }
        if (!/^(\+|00)[1-9][\d\s.\-()]{6,}$/.test(destSignal)) {
          // Il backend rifiuta comunque un numero senza prefisso, ma qui si dice *prima*: senza il
          // `+39`, `3351234567` diventerebbe `+3351234567`, cioè un numero francese.
          avvisa({ tipo: 'err', testo: `Il numero Signal ${destSignal} non è in forma internazionale: serve il prefisso, per esempio +393351234567.` });
          return;
        }
        const resSignal = await sendSignalDirectApi(
          destSignal,
          testoDaInviare,
          fileAllegato ? [{ nome: fileAllegato.nome, base64: fileAllegato.base64 }] : undefined,
          comunicazioneId,
        );
        if (resSignal && resSignal.success) {
          esitoInvio = { stato: 'inviato' };
          avvisa({ tipo: 'ok', testo: `✓ Il demone Signal ha accettato il messaggio per ${destSignal}.` });
        } else {
          esitoInvio = { stato: 'non-inviato', errore: resSignal?.errore };
          avvisa({ tipo: 'err', testo: `Signal non ha accettato l'invio verso ${destSignal}: ${resSignal?.errore || 'motivo non riportato'}. Il messaggio resta nel registro del fascicolo.` });
        }
      } else if (canale === 'telegram') {
        // Stessa storia di Signal: la chiamata al Bot API era privata dentro `otpDispatch.ts`,
        // quindi non raggiungibile da qui, e il ramo mancante finiva nell'`else` che annunciava la
        // consegna. Ora la chiamata sta in `telegramService.ts` e c'è una rotta.
        const destTelegram = (contatto.telegram || '').trim();
        if (!destTelegram) {
          avvisa({ tipo: 'err', testo: `Nessuna chat Telegram per ${nomeCliente || 'il cliente'}: il cliente deve prima scrivere al bot dello studio, poi la chat id va in anagrafica.` });
          return;
        }
        if (!/^-?\d{5,20}$/.test(destTelegram)) {
          avvisa({ tipo: 'err', testo: `«${destTelegram}» non è una chat Telegram: serve l'identificativo numerico, quello che il bot riceve quando il cliente gli scrive.` });
          return;
        }
        const resTelegram = await sendTelegramDirectApi(destTelegram, testoDaInviare, comunicazioneId);
        if (resTelegram && resTelegram.success) {
          esitoInvio = { stato: 'inviato' };
          avvisa({ tipo: 'ok', testo: `✓ Telegram ha accettato il messaggio per la chat ${destTelegram}.` });
        } else {
          esitoInvio = { stato: 'non-inviato', errore: resTelegram?.errore };
          avvisa({ tipo: 'err', testo: `Telegram non ha accettato l'invio: ${resTelegram?.errore || 'motivo non riportato'}. Il messaggio resta nel registro del fascicolo.` });
        }
      } else if (canale === 'portal') {
        // Il messaggio è già stato persistito al punto 1: il portale lo mostra al cliente senza che
        // ricarichi la pagina, e non c'è nessun dispatch esterno da fare.
        avvisa({ tipo: 'ok', testo: `✓ Messaggio inviato sul Portale Riservato di ${contatto.referente || nomeCliente}: visibile al cliente entro 5 secondi.` });
      }

      if (esitoInvio) {
        onEsito?.(nuovoMsg.id, esitoInvio);
      }
    } catch (err) {
      // Prima ogni errore diventava «✓ Messaggio salvato nel registro del progetto!»: il riscontro
      // verde compariva anche quando la richiesta non era mai arrivata al server.
      console.warn('Errore invio comunicazione:', err);
      avvisa({ tipo: 'err', testo: `Invio non riuscito: ${err instanceof Error ? err.message : 'errore di rete'}. Il messaggio è visibile qui ma potrebbe non essere stato registrato.` });
    } finally {
      setInviando(false);
      setTimeout(() => avvisa(null), 4000);
    }
  };

  return {
    canale, setCanale: sceglieCanale,
    testo, setTesto,
    fileAllegato, setFileAllegato, fileInputRef,
    customDestEmail, setCustomDestEmail,
    inviando, caricandoFile,
    invia,
  };
}
