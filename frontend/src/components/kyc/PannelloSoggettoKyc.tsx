import { useState } from 'react';
import { salvaSoggettoKyc, type FascicoloKyc, type SoggettoKyc } from '../../api/kyc';

/**
 * §02 — Soggetto (Party) del fascicolo, creabile/modificabile dallo studio. Il soggetto principale è
 * il perno su cui poggiano titolari effettivi, screening, dossier STR e report: senza, restavano
 * «n/d» perché il soggetto si popolava solo dal caricamento del cliente sul portale. Qui l'operatore
 * lo compila. Uno solo per fascicolo (il PUT crea se manca, aggiorna se c'è).
 */
export function PannelloSoggettoKyc({ fascicolo, puoModificare, onAggiornato }: {
  fascicolo: FascicoloKyc; puoModificare: boolean; onAggiornato: () => void;
}) {
  const s: Partial<SoggettoKyc> = fascicolo.soggetto ?? {};
  const [tipo, setTipo] = useState<'persona_fisica' | 'persona_giuridica'>(s.tipo ?? 'persona_fisica');
  const [denominazione, setDenominazione] = useState(s.denominazione ?? '');
  const [codiceFiscale, setCodiceFiscale] = useState(s.codiceFiscale ?? '');
  const [partitaIva, setPartitaIva] = useState(s.partitaIva ?? '');
  const [luogoNascita, setLuogoNascita] = useState(s.luogoNascita ?? '');
  const [dataNascita, setDataNascita] = useState(s.dataNascita ?? '');
  const [paeseResidenza, setPaeseResidenza] = useState(s.paeseResidenza ?? '');
  const [indirizzo, setIndirizzo] = useState(s.indirizzo ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const salva = async () => {
    if (denominazione.trim().length < 2) { setMsg('Denominazione obbligatoria.'); return; }
    setBusy(true); setMsg(null);
    try {
      await salvaSoggettoKyc(fascicolo.id, {
        tipo, denominazione: denominazione.trim(),
        codiceFiscale: codiceFiscale.trim() || undefined, partitaIva: partitaIva.trim() || undefined,
        luogoNascita: luogoNascita.trim() || undefined, dataNascita: dataNascita.trim() || undefined,
        paeseResidenza: paeseResidenza.trim() || undefined, indirizzo: indirizzo.trim() || undefined,
      });
      onAggiornato();
      setMsg('Soggetto salvato.');
    } catch (e: any) { setMsg(e?.message || 'Errore salvataggio soggetto'); } finally { setBusy(false); }
  };

  const inputStyle = { fontSize: 11, flex: 1, minWidth: 130 } as const;
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>👤 Soggetto della pratica (Party)</div>
      {!fascicolo.soggetto && <div style={{ fontSize: 10, color: 'var(--pill-amber-fg)' }}>Nessun soggetto: compilalo, altrimenti titolari effettivi, screening e report restano incompleti.</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={tipo} disabled={!puoModificare} onChange={(e) => setTipo(e.target.value as any)} style={{ fontSize: 11 }}>
          <option value="persona_fisica">Persona fisica</option>
          <option value="persona_giuridica">Persona giuridica</option>
        </select>
        <input value={denominazione} disabled={!puoModificare} onChange={(e) => setDenominazione(e.target.value)} placeholder="Denominazione / Nome e cognome" style={{ ...inputStyle, minWidth: 200 }} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input value={codiceFiscale} disabled={!puoModificare} onChange={(e) => setCodiceFiscale(e.target.value)} placeholder="Codice fiscale" style={inputStyle} />
        <input value={partitaIva} disabled={!puoModificare} onChange={(e) => setPartitaIva(e.target.value)} placeholder="Partita IVA" style={inputStyle} />
        <input value={paeseResidenza} disabled={!puoModificare} onChange={(e) => setPaeseResidenza(e.target.value)} placeholder="Paese residenza" style={{ ...inputStyle, minWidth: 90 }} />
      </div>
      {tipo === 'persona_fisica' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input value={luogoNascita} disabled={!puoModificare} onChange={(e) => setLuogoNascita(e.target.value)} placeholder="Luogo di nascita" style={inputStyle} />
          <input value={dataNascita} disabled={!puoModificare} onChange={(e) => setDataNascita(e.target.value)} placeholder="Data di nascita (AAAA-MM-GG)" style={inputStyle} />
        </div>
      )}
      <input value={indirizzo} disabled={!puoModificare} onChange={(e) => setIndirizzo(e.target.value)} placeholder="Indirizzo / Sede" style={{ fontSize: 11 }} />
      {puoModificare && (
        <div><button type="button" disabled={busy} onClick={salva} className="btn btn-sm btn-primary">{busy ? '…' : '💾 Salva soggetto'}</button></div>
      )}
      {msg && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{msg}</span>}
    </div>
  );
}
