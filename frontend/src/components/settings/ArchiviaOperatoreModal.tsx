import { useState } from 'react';
import { archiviaUtenteTenantApi, riattivaUtenteTenantApi } from '../../api/client';

interface ArchiviaOperatoreModalProps {
  /** La persona su cui si agisce, con i suoi periodi di collaborazione. */
  persona: any;
  /** `archivia` chiude il periodo aperto, `riattiva` ne apre uno nuovo. */
  verso: 'archivia' | 'riattiva';
  onClose: () => void;
  /** Ricarica l'elenco del team dopo un'operazione riuscita. */
  onFatto: () => void;
}

/** Oggi come `AAAA-MM-GG`, nel fuso di chi guarda lo schermo. */
function oggiIso(): string {
  const d = new Date();
  const mese = String(d.getMonth() + 1).padStart(2, '0');
  const giorno = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mese}-${giorno}`;
}

/**
 * Una data dell'API in `GG/MM/AAAA`.
 *
 * L'API restituisce le date come istante ISO (`2024-03-12T00:00:00.000Z`) costruite a
 * mezzanotte **locale** di chi le ha scritte. Per rimostrare lo stesso giorno vanno rilette nel
 * fuso locale: tagliare i primi dieci caratteri della stringa darebbe il giorno prima. Una
 * stringa che è già solo un giorno (`AAAA-MM-GG`) si taglia invece così com'è, perché
 * `new Date` la interpreterebbe come mezzanotte UTC.
 */
function inItaliano(iso?: string | null): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [anno, mese, giorno] = iso.split('-');
    return `${giorno}/${mese}/${anno}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const mese = String(d.getMonth() + 1).padStart(2, '0');
  const giorno = String(d.getDate()).padStart(2, '0');
  return `${giorno}/${mese}/${d.getFullYear()}`;
}

/**
 * Archiviazione e riattivazione di un operatore (§2bis).
 *
 * La data è **precompilata a oggi ma modificabile**: il giorno in cui una collaborazione
 * finisce non è per forza quello in cui qualcuno si ricorda di archiviare, e riscriverlo dopo
 * significherebbe falsificare un registro che serve proprio a ricordare.
 *
 * Le date dei periodi non si modificano da qui: un periodo chiuso è un fatto, non una bozza.
 * Se è stato registrato male, si riattiva e si richiude con la data giusta — resta la traccia
 * di entrambe le operazioni nell'audit.
 */
export function ArchiviaOperatoreModal({ persona, verso, onClose, onFatto }: ArchiviaOperatoreModalProps) {
  const [data, setData] = useState(oggiIso());
  const [motivo, setMotivo] = useState('');
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const periodi: any[] = Array.isArray(persona?.periodiCollaborazione) ? persona.periodiCollaborazione : [];
  const aperto = periodi.find(p => p.al === null) ?? null;
  const ultimoChiuso = [...periodi].reverse().find(p => p.al !== null) ?? null;

  const archivia = verso === 'archivia';
  const nome = persona?.nome || persona?.name || 'questa persona';

  const conferma = async () => {
    setInCorso(true);
    setErrore(null);
    try {
      if (archivia) {
        await archiviaUtenteTenantApi(persona.id, { dataFine: data, motivo: motivo.trim() || undefined });
      } else {
        await riattivaUtenteTenantApi(persona.id, { dataInizio: data });
      }
      onFatto();
      onClose();
    } catch (err: any) {
      setErrore(err?.message || 'Operazione non riuscita');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--sidebar, var(--surface-2))',
          border: '1px solid var(--border, var(--border))',
          borderRadius: 18,
          width: '100%',
          maxWidth: 480,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--pill-indigo-bg)', color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
              {archivia ? '📦' : '↩️'}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--pill-sky-fg)' }}>
                {archivia ? 'Archivia operatore' : 'Riattiva operatore'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {nome} ({persona?.email})
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Chiudi la finestra"
            style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {errore && (
          <div style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--red)', color: 'var(--pill-red-fg)', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>
            ⚠️ {errore}
          </div>
        )}

        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
          {archivia ? (
            <>
              {aperto && (
                <div style={{ marginBottom: 8 }}>
                  In forza dal <strong>{inItaliano(aperto.dal)}</strong>.
                </div>
              )}
              L'utenza viene spenta: {nome} non potrà più accedere e non comparirà più tra gli
              operatori assegnabili. <strong>Nulla viene cancellato</strong> — progetti, ore e
              documenti restano, e se un giorno rientra si riattiva con un periodo nuovo.
            </>
          ) : (
            <>
              {ultimoChiuso && (
                <div style={{ marginBottom: 8 }}>
                  Ha lavorato qui dal <strong>{inItaliano(ultimoChiuso.dal)}</strong> al{' '}
                  <strong>{inItaliano(ultimoChiuso.al)}</strong>.
                </div>
              )}
              Si apre un <strong>nuovo periodo</strong>: quello precedente resta agli atti.
              L'utenza torna attiva e {nome} ricompare tra gli operatori assegnabili.
            </>
          )}
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>
            {archivia ? 'Data di fine collaborazione' : 'Data di inizio collaborazione'}
          </span>
          <input
            type="date"
            value={data}
            onChange={e => setData(e.target.value)}
            style={{
              background: 'var(--surface-3)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 12px',
              color: 'var(--text)',
              fontSize: 13,
            }}
          />
        </label>

        {archivia && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>Motivo (facoltativo)</span>
            <input
              type="text"
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="Es. fine collaborazione, trasferimento…"
              maxLength={200}
              style={{
                background: 'var(--surface-3)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '8px 12px',
                color: 'var(--text)',
                fontSize: 13,
              }}
            />
          </label>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={conferma}
            disabled={inCorso || !data}
            style={{
              background: archivia
                ? 'linear-gradient(135deg, var(--red) 0%, var(--red) 100%)'
                : 'linear-gradient(135deg, var(--green) 0%, var(--green) 100%)',
              color: '#fff',
              border: 'none',
              padding: '8px 18px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: inCorso || !data ? 'not-allowed' : 'pointer',
              opacity: inCorso || !data ? 0.6 : 1,
            }}
          >
            {inCorso ? 'Un momento…' : archivia ? '📦 Archivia' : '↩️ Riattiva'}
          </button>
        </div>
      </div>
    </div>
  );
}
