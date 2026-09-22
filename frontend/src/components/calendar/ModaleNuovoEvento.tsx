/**
 * §1ter.5 (B3-B4) — il modale di un nuovo evento.
 *
 * ## Tre cose che questo modale faceva e non fa più
 *
 * **L'elenco dei clienti era scritto nel sorgente** (B3): quattro righe fisse — «Holding Beta
 * S.r.l.», «Gamma Real Estate S.r.l.», «Delta Tech Kft», «Famiglia Conti» — e la prima
 * preselezionata. Chiunque aprisse il modale in qualunque studio vedeva quei quattro nomi, nessuno
 * dei quali era un cliente di quello studio. Ora l'elenco viene da `fetchClienti()`, che è la
 * stessa chiamata che la pagina faceva **già** senza usarne il risultato per il modulo.
 *
 * **L'operatore era una persona fissa**: `useState('Joe Disabato')`, e nel campo `operatoreNome` di
 * ogni evento creato finiva quel nome. Ora è l'uuid di un membro reale dello studio, preso da
 * `useTeamMembers`, che è anche l'unico valore che `assegnato_a_id` accetta — è una chiave esterna.
 *
 * **Il salvataggio andava in `localStorage`** (B4). Ora è una `POST /calendario/eventi`, e il
 * modale non dichiara riuscito niente: aspetta la risposta, e se il server rifiuta mostra il
 * motivo che il server ha dato.
 *
 * ## Le categorie sono tre, e le altre tre non si offrono
 *
 * Il vecchio `<select>` ne proponeva cinque, e quattro di quelle la rotta le rifiuta con un 400:
 * `kyc`, `fattura` e `progetto` derivano da una riga che esiste altrove, e scriverne una a mano
 * creerebbe una seconda verità. Un modulo che offre scelte che l'API rifiuta è un modulo che fa
 * perdere il lavoro appena inserito.
 */
import { useState, type CSSProperties, type FormEvent } from 'react';
import { creaEventoCalendario } from '../../api/calendario';
import type { TeamMember } from '../../types';
import { istanteDaGiornoEOra, type GiornoIso } from '../../utils/calendarioDate';
import { Modal } from '../ui/Modal';

export interface ClienteSemplice {
  id: string;
  nome: string;
}

interface Props {
  /** Il giorno da cui parte il modulo: quello di oggi, o la casella su cui si è cliccato. */
  giornoIniziale: GiornoIso;
  clienti: ClienteSemplice[];
  team: TeamMember[];
  onChiudi: () => void;
  /** Chiamata dopo che il server ha confermato la scrittura: ricarica la griglia. */
  onCreato: () => Promise<void>;
}

const CAMPO: CSSProperties = { width: '100%', fontSize: 12 };
const ETICHETTA: CSSProperties = { fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 };

export function ModaleNuovoEvento({ giornoIniziale, clienti, team, onChiudi, onCreato }: Props) {
  const [titolo, setTitolo] = useState('');
  const [giorno, setGiorno] = useState<GiornoIso>(giornoIniziale);
  // Vuoto significa «tutto il giorno», che è il caso normale di una scadenza: un'ora inventata a
  // mezzanotte verrebbe mostrata come tale.
  const [ora, setOra] = useState('');
  const [categoria, setCategoria] = useState<'promemoria' | 'contratto'>('promemoria');
  const [priorita, setPriorita] = useState<'alta' | 'media' | 'normale'>('normale');
  const [clienteId, setClienteId] = useState('');
  const [assegnatoAId, setAssegnatoAId] = useState('');
  const [note, setNote] = useState('');
  const [luogoUrl, setLuogoUrl] = useState('');
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const invia = async (e: FormEvent) => {
    e.preventDefault();
    if (inCorso) return;

    if (!titolo.trim()) {
      setErrore('Il titolo è obbligatorio.');
      return;
    }

    setInCorso(true);
    setErrore(null);
    try {
      await creaEventoCalendario({
        titolo: titolo.trim(),
        dataInizio: istanteDaGiornoEOra(giorno, ora || null),
        categoria,
        priorita,
        note: note.trim() || null,
        luogoUrl: luogoUrl.trim() || null,
        clienteId: clienteId || null,
        assegnatoAId: assegnatoAId || null,
      });
      await onCreato();
      onChiudi();
    } catch (err: any) {
      // Il messaggio è quello del server. Sostituirlo con «salvataggio non riuscito» toglierebbe
      // l'unica informazione utile: quale campo ha rifiutato e perché.
      setErrore(err?.message || 'Salvataggio non riuscito.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <Modal onClose={onChiudi} labelledBy="titolo-nuovo-evento" zIndex={100}>
      {(richiediChiusura) => (
      <form onSubmit={invia} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '90vh', overflowY: 'auto' }}>
        <div id="titolo-nuovo-evento" style={{ fontSize: 16, fontWeight: 700 }}>+ Nuovo Evento / Promemoria Studio</div>

        {errore && (
          <div role="alert" style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bd)', color: 'var(--pill-red-fg)', padding: '10px 14px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
            ⚠️ {errore}
          </div>
        )}

        <div>
          <label style={ETICHETTA}>Titolo Scadenza *</label>
          <input type="text" value={titolo} onChange={(e) => setTitolo(e.target.value)} required maxLength={200} placeholder="Es. Consegna fascicolo notarile" style={CAMPO} />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={ETICHETTA}>Data Scadenza *</label>
            <input type="date" value={giorno} onChange={(e) => setGiorno(e.target.value)} required style={CAMPO} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={ETICHETTA}>Ora (facoltativa)</label>
            <input type="time" value={ora} onChange={(e) => setOra(e.target.value)} style={CAMPO} />
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>Vuota = tutto il giorno</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={ETICHETTA}>Categoria *</label>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value as 'promemoria' | 'contratto')} style={{ padding: 8, fontSize: 12, width: '100%' }}>
              <option value="promemoria">🔔 Promemoria Team</option>
              <option value="contratto">📜 Scadenza Contrattuale</option>
            </select>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              KYC, fatture e fini progetto li calcola il sistema dalle loro date: non si scrivono qui.
            </span>
          </div>

          <div style={{ flex: 1 }}>
            <label style={ETICHETTA}>Priorità *</label>
            <select value={priorita} onChange={(e) => setPriorita(e.target.value as 'alta' | 'media' | 'normale')} style={{ padding: 8, fontSize: 12, width: '100%' }}>
              <option value="alta">🔴 Alta</option>
              <option value="media">🟡 Media</option>
              <option value="normale">🟢 Normale</option>
            </select>
          </div>
        </div>

        <div>
          <label style={ETICHETTA}>Cliente Associato</label>
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} style={{ padding: 8, fontSize: 12, width: '100%' }}>
            <option value="">— nessun cliente —</option>
            {clienti.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
          {clienti.length === 0 && (
            // Regola 7: l'assenza di clienti si dice. Un elenco vuoto senza spiegazione sembra un
            // campo rotto, e la prima ipotesi di chi lo vede è che l'app non funzioni.
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              Nessun cliente in anagrafica per questo studio.
            </span>
          )}
        </div>

        <div>
          <label style={ETICHETTA}>Operatore Responsabile</label>
          <select value={assegnatoAId} onChange={(e) => setAssegnatoAId(e.target.value)} style={{ padding: 8, fontSize: 12, width: '100%' }}>
            <option value="">— non assegnata —</option>
            {team.map((m) => (
              // `dbId` e non `id`: `id` è l'identificativo numerico della UI, e in
              // `assegnato_a_id` — che è una chiave esterna verso `user` — non può stare.
              <option key={m.dbId} value={m.dbId}>{m.n} ({m.r})</option>
            ))}
          </select>
          {team.length === 0 && (
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              Nessun collaboratore assegnabile in questo studio.
            </span>
          )}
        </div>

        <div>
          <label style={ETICHETTA}>Note Operative</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Dettagli ed istruzioni per l'operatore..." style={CAMPO} />
        </div>

        <div>
          <label style={ETICHETTA}>Luogo o Link (facoltativo)</label>
          <input type="text" value={luogoUrl} onChange={(e) => setLuogoUrl(e.target.value)} placeholder="Sala riunioni, oppure https://meet.google.com/…" style={CAMPO} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <button type="button" onClick={richiediChiusura} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>
            Annulla
          </button>
          <button type="submit" disabled={inCorso} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: inCorso ? 'wait' : 'pointer', opacity: inCorso ? 0.7 : 1 }}>
            {inCorso ? 'Salvataggio…' : '✓ Salva Evento'}
          </button>
        </div>
      </form>
      )}
    </Modal>
  );
}
