import { useEffect, useState } from 'react';
import { useToast } from '../ui/ToastProvider';
import { confirm } from '../ui/ConfirmProvider';
import {
  disattivaTokenBackupApi,
  fetchStatoBackupAdminApi,
  formattaByte,
  salvaTokenBackupApi,
  type StatoBackupAdmin,
} from '../../api/backup';
import { formattaFreschezza, sintesiCopia } from '../../utils/backupStato';

/**
 * Voce 8-bis — la copia off-site del backup, dal pannello del super admin.
 *
 * **Perché il campo del token è a senso unico.** La credenziale si incolla, si salva e non si
 * rilegge mai: il server non la restituisce (regola 6, come `leadAdvisorPassword`). Perciò il
 * campo non è precompilato e non c'è nessun «mostra»: si può solo sostituire o disattivare.
 *
 * **Perché la schermata dice su quale backend sta lavorando.** La credenziale vive in un file
 * sul server che esegue i backup. L'app gira su tre backend — Vercel (solo frontend), Railway e
 * il VPS — e Railway ha un **database diverso** dal VPS: un token salvato da lì non arriverebbe
 * mai al backup notturno, e la scrittura fallirebbe senza che nessuno se ne accorga. Quindi i due
 * percorsi si mostrano, e se la cartella non c'è lo si dice invece di far credere che il
 * salvataggio sia arrivato da qualche parte (regola 7).
 */
export function PannelloBackupOffSite() {
  const toast = useToast();
  const [stato, setStato] = useState<StatoBackupAdmin | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  const [erroreCaricamento, setErroreCaricamento] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [salvataggio, setSalvataggio] = useState(false);

  const carica = async () => {
    setCaricamento(true);
    try {
      setStato(await fetchStatoBackupAdminApi());
      setErroreCaricamento(null);
    } catch (err: any) {
      setErroreCaricamento(err?.message || 'Stato del backup non disponibile');
    } finally {
      setCaricamento(false);
    }
  };

  useEffect(() => { void carica(); }, []);

  const salva = async () => {
    // Il campo non conserva niente dopo il salvataggio: si svuota comunque, anche in caso di
    // errore, perché un token rimasto a schermo è un token in una schermata condivisa.
    if (!token.trim()) {
      toast.attenzione('Incolla il token JSON stampato da `rclone authorize dropbox`.');
      return;
    }
    setSalvataggio(true);
    try {
      const esito = await salvaTokenBackupApi(token);
      setToken('');
      await carica();
      toast.successo(esito?.messaggio || 'Credenziale salvata.');
    } catch (err: any) {
      setToken('');
      toast.errore(err?.message || 'Salvataggio non riuscito');
    } finally {
      setSalvataggio(false);
    }
  };

  const disattiva = async () => {
    if (!(await confirm({
      titolo: 'Disattivare la copia off-site?',
      messaggio:
        'I backup continueranno a essere fatti, ma resteranno sullo stesso disco del database: se il server si perde, si perdono con lui.',
      confermaLabel: 'Disattiva',
      pericolo: true,
    }))) return;
    try {
      await disattivaTokenBackupApi();
      await carica();
      toast.successo('Copia off-site disattivata.');
    } catch (err: any) {
      toast.errore(err?.message || 'Rimozione non riuscita');
    }
  };

  const etichetta = (testo: string, valore: string, colore = 'var(--text)') => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px dashed var(--border)', fontSize: 12 }}>
      <span style={{ color: 'var(--muted)' }}>{testo}</span>
      <span style={{ color: colore, fontWeight: 600, textAlign: 'right' }}>{valore}</span>
    </div>
  );

  const sintesi = stato ? sintesiCopia(stato) : null;
  const coloreSintesi = sintesi?.livello === 'ok' ? 'var(--green)'
    : sintesi?.livello === 'errore' ? 'var(--red)'
    : sintesi?.livello === 'attenzione' ? 'var(--amber)'
    : 'var(--muted)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
          💾 Copia off-site del backup
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.6 }}>
          Il backup notturno copre database, documenti e segreti, ma su questa macchina c'è un solo
          disco: senza una copia fuori, un guasto del server porta via il database <strong>e</strong> i
          suoi backup. Qui si autorizza il server a copiarli su Dropbox.
        </div>
      </div>

      {caricamento && (
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, fontSize: 12, color: 'var(--muted)' }}>
          Lettura dello stato…
        </div>
      )}

      {erroreCaricamento && (
        <div style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--red)', borderRadius: 14, padding: 16, fontSize: 12, color: 'var(--pill-red-fg)' }}>
          ⚠️ {erroreCaricamento}
        </div>
      )}

      {stato && (
        <>
          {/* Il backend su cui si sta lavorando: senza questo, un salvataggio che non arriva al
              backup del VPS sembra riuscito. */}
          {!stato.configurazioneDisponibile && (
            <div style={{ background: 'var(--pill-amber-bg)', border: '1px solid var(--amber)', borderRadius: 14, padding: 16, fontSize: 12, color: 'var(--pill-amber-fg)', lineHeight: 1.6 }}>
              ⚠️ <strong>Questo backend non vede la cartella della credenziale</strong> ({stato.cartellaConfigurazione}).
              La copia off-site si configura dal server che esegue i backup — il VPS — perché è lì che
              la credenziale serve. Da qui il salvataggio verrebbe rifiutato: meglio saperlo adesso che
              credere di aver configurato qualcosa.
            </div>
          )}

          <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Stato</div>
            {sintesi && (
              <div style={{ fontSize: 13, fontWeight: 700, color: coloreSintesi, marginBottom: 4 }}>
                {sintesi.livello === 'ok' ? '✓ ' : sintesi.livello === 'errore' ? '🔴 ' : sintesi.livello === 'attenzione' ? '⚠️ ' : '❔ '}
                {sintesi.titolo}
              </div>
            )}
            {sintesi && <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>{sintesi.dettaglio}</div>}

            <div style={{ marginTop: 12 }}>
              {etichetta('Credenziale', stato.configurato ? 'salvata' : 'non configurata', stato.configurato ? 'var(--green)' : 'var(--amber)')}
              {etichetta('Salvata il', stato.configuratoIl ? (formattaFreschezza(stato.configuratoIl) || '—') : '—')}
              {etichetta('Destinazione', stato.destinazione || 'non impostata (BLUMAN_BACKUP_RCLONE_REMOTE)',
                stato.destinazione ? 'var(--text)' : 'var(--amber)')}
              {etichetta('Ultimo backup',
                stato.backup.quando
                  ? `${stato.backup.esito === 'ok' ? 'riuscito' : stato.backup.esito === 'fallito' ? 'fallito' : 'sconosciuto'} · ${formattaFreschezza(stato.backup.quando)}`
                  : 'nessuna informazione',
                stato.backup.esito === 'ok' ? 'var(--green)' : stato.backup.esito === 'fallito' ? 'var(--red)' : 'var(--muted)')}
              {stato.backup.file && etichetta('File', `${stato.backup.file}${formattaByte(stato.backup.byte) ? ` (${formattaByte(stato.backup.byte)})` : ''}`)}
              {etichetta('Copia sul remoto',
                stato.backup.copiaOffSite === 'ok' ? 'fatta'
                  : stato.backup.copiaOffSite === 'saltata' ? 'non tentata'
                  : stato.backup.copiaOffSite === 'fallita' ? 'FALLITA'
                  : 'sconosciuta',
                stato.backup.copiaOffSite === 'ok' ? 'var(--green)' : stato.backup.copiaOffSite === 'fallita' ? 'var(--red)' : 'var(--muted)')}
              {etichetta('Verifica del monitor',
                stato.verifica.stato === 'ok' ? 'la copia c’è'
                  : stato.verifica.stato === 'fail' ? 'problema rilevato'
                  : 'non ancora disponibile',
                stato.verifica.stato === 'ok' ? 'var(--green)' : stato.verifica.stato === 'fail' ? 'var(--red)' : 'var(--muted)')}
              {stato.verifica.dettaglio && etichetta('Dettaglio verifica', stato.verifica.dettaglio)}
              {etichetta('Cartella di stato', stato.cartellaStato)}
            </div>

            {/* La distinzione che conta: un backup riuscito e una copia che esiste davvero sono
                due fatti diversi, ed è quando l'autenticazione scade che divergono. */}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
              «Copia sul remoto» è ciò che ha dichiarato lo script del backup; «Verifica del monitor»
              è ciò che il monitor ha <em>constatato</em> interrogando Dropbox, una volta al giorno.
              Il secondo è l'unico che si accorge di un'autenticazione scaduta.
            </div>
          </div>

          <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Credenziale rclone</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
              Su una macchina <strong>con browser</strong> esegui <code>rclone authorize dropbox</code>,
              autorizza l'accesso e incolla qui il JSON che stampa. Il campo non si rilegge: si può
              solo sostituire o disattivare. Serve anche <code>refresh_token</code>, altrimenti la
              copia funzionerebbe poche ore e poi si fermerebbe senza avvisare.
            </div>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder='{"access_token":"…","token_type":"bearer","expires_in":14400,"refresh_token":"…","scope":"…","uid":"…","account_id":"…"}'
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 11, padding: 10, borderRadius: 8, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={salva}
                disabled={salvataggio || !stato.configurazioneDisponibile}
                title={stato.configurazioneDisponibile ? 'Salva la credenziale' : 'Questo backend non vede la cartella della credenziale'}
                style={{
                  background: stato.configurazioneDisponibile ? 'var(--indigo)' : 'var(--surface-2)',
                  color: stato.configurazioneDisponibile ? '#fff' : 'var(--muted)',
                  border: 'none', padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  cursor: stato.configurazioneDisponibile ? 'pointer' : 'default',
                }}
              >
                {salvataggio ? 'Salvataggio…' : stato.configurato ? 'Sostituisci credenziale' : 'Salva credenziale'}
              </button>
              {stato.configurato && (
                <button
                  type="button"
                  onClick={disattiva}
                  style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--red)', color: 'var(--pill-red-fg)', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >
                  Disattiva la copia off-site
                </button>
              )}
              <button
                type="button"
                onClick={() => void carica()}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
              >
                ↻ Ricontrolla
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
              La credenziale non entra nel database e non entra nel <code>.env</code>: il database
              <strong> è</strong> ciò che viene spedito su Dropbox, e il <code>.env</code> viene archiviato
              insieme a esso. Una credenziale scritta lì viaggerebbe insieme alla cassaforte che apre.
              Vive in un file dedicato sul server, leggibile solo dall'API e dallo script del backup.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
