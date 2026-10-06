import { useState } from 'react';
import type { Cliente } from '../../types';
import { ComposerComunicazione } from '../ComposerComunicazione';
import { useInvioComunicazione, type CanaleInvio } from '../../hooks/useInvioComunicazione';
import { useCanaliStudio } from '../../hooks/useCanaliStudio';
import { recapitiDaAnagrafica } from '../../utils/recapitiCliente';

/**
 * Il compositore montato **dentro una micro-voce**: risponde al cliente restando dove si sta
 * leggendo, e il messaggio nasce già abbinato a questa voce.
 *
 * Perché un guscio e non tutto dentro `PassaggioModal`. Le due cose che servono al compositore —
 * l'anagrafica del cliente e le linee dello studio — sono **letture**, e `useCanaliStudio` chiede le
 * impostazioni al server al montaggio. Montarlo nel modale significherebbe una richiesta a ogni
 * apertura di una micro-voce, anche per chi apre solo la checklist; così la richiesta la fa chi
 * disegna davvero il compositore, e solo quando c'è una voce a database a cui legare il messaggio.
 *
 * Il riscontro dell'invio vive **qui** e non nel modale: è l'unico posto che lo mostra, e uno stato
 * in più nel padre sarebbe un secondo riquadro da tenere allineato senza che nessuno lo legga.
 */
export function ComposerMicrovoce({
  progettoId,
  microvoceProgettoId,
  nomeCliente,
  cliente,
  canalePredefinito,
  onInviato,
}: {
  /** L'id a database della pratica: senza, il messaggio non ha un fascicolo dove nascere. */
  progettoId: string;
  /** L'id a database della voce: è ciò che fa nascere il messaggio abbinato. */
  microvoceProgettoId: string;
  nomeCliente?: string;
  /** L'anagrafica del cliente della pratica, da cui si leggono i recapiti. Può mancare. */
  cliente?: Cliente | null;
  /**
   * Il canale su cui si risponde di solito in questa voce: quello dell'ultimo messaggio, ripiego
   * `portal`. Resta un **predefinito**, non un vincolo — l'operatore può cambiarlo, e da quel
   * momento la sua scelta vince (vedi `useInvioComunicazione`).
   */
  canalePredefinito?: CanaleInvio;
  /** Chiamato quando la riga è stata creata, perché il modale rilegga i messaggi della voce. */
  onInviato?: () => void;
}) {
  const studioChannels = useCanaliStudio();
  const contatto = recapitiDaAnagrafica(cliente, nomeCliente);
  const [feedback, setFeedback] = useState<{ tipo: 'ok' | 'err'; testo: string } | null>(null);

  const invio = useInvioComunicazione({
    progettoId,
    nomeCliente,
    contatto,
    microvoceProgettoId,
    canalePredefinito,
    onFeedback: setFeedback,
    // Non è la riga ottimistica a comparire qui: il modale rilegge dal server, così la card porta
    // l'origine vera che il backend ha registrato (`✍ scritto da qui`) invece di una supposizione
    // del browser su come si chiama. E rilegge su `onRegistrato`, non su `onInviato`: quello scatta
    // prima della scrittura, e l'elenco tornerebbe senza la riga appena creata.
    onRegistrato: () => onInviato?.(),
  });

  return (
    <ComposerComunicazione
      invio={invio}
      contatto={contatto}
      studioChannels={studioChannels}
      microvoceProgettoId={microvoceProgettoId}
      feedback={feedback}
    />
  );
}
