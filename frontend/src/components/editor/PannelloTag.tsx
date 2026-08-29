export function PannelloTag({
  insertSmartTag,
}: {
  insertSmartTag: (tag: string) => void;
}) {
  return (
    <>
          {/* Smart Tags Selector (Stile OpenSTAManager) */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🏷 Smart Tags Anagrafica ERP</span>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 12 }}>
              Clicca su un tag per inserirlo nel documento al cursore.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--indigo-l)', textTransform: 'uppercase' }}>Dati Cliente Committente:</span>
              {[
                { tag: '{{cliente.ragione_sociale}}', label: 'Ragione Sociale / Nome' },
                { tag: '{{cliente.partita_iva}}', label: 'Partita IVA' },
                { tag: '{{cliente.codice_fiscale}}', label: 'Codice Fiscale' },
                { tag: '{{cliente.sede_legale}}', label: 'Sede Legale' },
                { tag: '{{cliente.referente}}', label: 'Nome Referente / UBO' },
                { tag: '{{cliente.pec}}', label: 'Indirizzo PEC' },
                { tag: '{{cliente.sdi}}', label: 'Codice SDI' },
                { tag: '{{cliente.cellulare}}', label: 'Cellulare WhatsApp' },
              ].map(item => (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => insertSmartTag(item.tag)}
                  style={{
                    background: 'var(--card2)',
                    border: '1px solid var(--border)',
                    padding: '5px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    textAlign: 'left',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                  title={`Inserisci ${item.tag}`}
                >
                  <span style={{ fontWeight: 600 }}>{item.label}</span>
                  <code style={{ fontSize: 9.5, color: '#818cf8', background: '#1e1b4b', padding: '1px 5px', borderRadius: 4 }}>+ Tag</code>
                </button>
              ))}

              <span style={{ fontSize: 10, fontWeight: 800, color: '#34d399', textTransform: 'uppercase', marginTop: 10 }}>Dati Progetto:</span>
              {[
                { tag: '{{progetto.titolo}}', label: 'Titolo Pratica' },
                { tag: '{{progetto.importo_totale}}', label: 'Compenso Totale (€)' },
                { tag: '{{data_odierna}}', label: 'Data Odierna' },
              ].map(item => (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => insertSmartTag(item.tag)}
                  style={{
                    background: 'var(--card2)',
                    border: '1px solid var(--border)',
                    padding: '5px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    textAlign: 'left',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{item.label}</span>
                  <code style={{ fontSize: 9.5, color: '#34d399', background: '#064e3b', padding: '1px 5px', borderRadius: 4 }}>+ Tag</code>
                </button>
              ))}

              <span style={{ fontSize: 10, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', marginTop: 10 }}>Dati Studio:</span>
              {[
                { tag: '{{studio.ragione_sociale}}', label: 'Nome Studio' },
                { tag: '{{studio.piva}}', label: 'P.IVA / TIN Studio' },
                { tag: '{{studio.sede_legale}}', label: 'Sede Legale Studio' },
                { tag: '{{studio.iban}}', label: 'IBAN Bonifici Studio' },
              ].map(item => (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => insertSmartTag(item.tag)}
                  style={{
                    background: 'var(--card2)',
                    border: '1px solid var(--border)',
                    padding: '5px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    textAlign: 'left',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{item.label}</span>
                  <code style={{ fontSize: 9.5, color: '#f59e0b', background: '#451a03', padding: '1px 5px', borderRadius: 4 }}>+ Tag</code>
                </button>
              ))}

              {/* §36 — Aree firma. Non sono dati anagrafici: dicono al server DOVE, nel
                  documento, va disegnata la firma quando il cliente sottoscrive dal
                  portale. Senza `{{firma_cliente}}` la firma resta fuori dal testo (nel
                  sigillo e nel verbale), esattamente come prima. */}
              <span style={{ fontSize: 10, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', marginTop: 10 }}>Aree Firma:</span>
              <div style={{ fontSize: 9.5, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 2 }}>
                Dove inserisci il tag comparirà lo spazio per la firma. Alla sottoscrizione dal
                portale il server ricompone il documento con la firma del cliente dentro
                quell'area, e lo archivia come copia firmata accanto all'originale.
              </div>
              {[
                { tag: '{{firma_cliente}}', label: 'Firma del Cliente' },
                { tag: '{{firma_studio}}', label: 'Firma dello Studio' },
              ].map(item => (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => insertSmartTag(item.tag)}
                  style={{
                    background: 'var(--card2)',
                    border: '1px solid var(--border)',
                    padding: '5px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    textAlign: 'left',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                  title={`Inserisci ${item.tag}`}
                >
                  <span style={{ fontWeight: 600 }}>{item.label}</span>
                  <code style={{ fontSize: 9.5, color: '#38bdf8', background: '#082f49', padding: '1px 5px', borderRadius: 4 }}>+ Firma</code>
                </button>
              ))}
            </div>
          </div>
    </>
  );
}
