// Le frasi con cui la posta dei clienti spiega se stessa: perché un messaggio è sotto un cliente,
// e in che stato è una casella. Funzioni pure, usate dai componenti di `components/posta/`.
import type { CasellaPosta, MessaggioPosta } from '../api/posta';

/** Perché il messaggio è sotto questo cliente, in una frase (regola 12). */
export function spiegaAttribuzione(m: Pick<MessaggioPosta, 'attribuzione' | 'criterio' | 'clienteId'>): string {
  // Era attribuito, ma il cliente è stato tolto dall'anagrafica: il messaggio resta e torna da smistare.
  if (!m.clienteId && m.attribuzione !== 'da_smistare') return 'Il cliente a cui era attribuito non è più in anagrafica: va smistato di nuovo.';
  if (m.attribuzione === 'manuale') return 'Attribuito a mano da un operatore.';
  if (m.attribuzione === 'da_smistare') return 'Nessun cliente riconosciuto: l’indirizzo di consegna non porta un inoltro attivo e nessun cliente ha questo indirizzo.';
  if (m.criterio === 'alias') return 'Attribuito in automatico: è arrivato all’indirizzo di inoltro di questo cliente.';
  if (m.criterio === 'casella') return 'Attribuito in automatico: viene dalla casella collegata di questo cliente.';
  if (m.criterio === 'destinatario') return 'Attribuito in automatico: l’indirizzo di questo cliente è fra i destinatari.';
  if (m.criterio === 'mittente') return 'Attribuito in automatico: lo ha scritto questo cliente dal suo indirizzo.';
  return 'Attribuito in automatico.';
}

/** In che stato è la casella, in parole: collegata e letta, ferma per scelta, ferma per un errore, scollegata. */
export function statoCasella(c: Pick<CasellaPosta, 'attiva' | 'passwordSalvata' | 'ultimoErrore'>): { testo: string; colore: 'green' | 'amber' | 'red' } {
  if (!c.passwordSalvata) return { testo: 'Scollegata', colore: 'amber' };
  if (!c.attiva) return { testo: 'In pausa', colore: 'amber' };
  if (c.ultimoErrore) return { testo: 'Non risponde', colore: 'red' };
  return { testo: 'Attiva', colore: 'green' };
}
