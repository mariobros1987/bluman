// I tre passi della firma della lettera d'incarico, in cima alla scheda «Proposta e firma».
// Colori dai token del tema: prima il riquadro aveva un fondo scuro scritto a mano e i testi
// col colore del tema, quindi nel tema chiaro era testo scuro su fondo scuro, illeggibile.
const PASSI = [
  { titolo: '1. Leggi la proposta', testo: 'I moduli inclusi, gli importi e il testo della lettera d\'incarico.' },
  { titolo: '2. Ricevi il codice', testo: 'Un codice di 6 cifre sul canale che scegli fra quelli disponibili.' },
  { titolo: '3. Firma', testo: 'Inserisci il codice: la firma elettronica è registrata e puoi scaricarne la ricevuta.' },
];

export function GuidaFirma() {
  return (
    <section aria-label="Come si firma" style={{ background: 'var(--pill-indigo-bg)', border: '1px solid var(--pill-indigo-bd)', borderRadius: 14, padding: 18, marginBottom: 22 }}>
      <div style={{ fontSize: 12, color: 'var(--pill-indigo-fg)', fontWeight: 800, marginBottom: 12 }}>Come si firma, in tre passi</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {PASSI.map((p) => (
          <div key={p.titolo} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{p.titolo}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.45 }}>{p.testo}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
