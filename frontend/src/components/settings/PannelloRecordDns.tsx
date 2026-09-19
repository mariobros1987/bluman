/**
 * §35 — i record DNS del dominio dello studio, senza inventare né il provider né lo stato.
 *
 * Com'era: una tabella intitolata «Configurazione Record DNS Dominio per Register.it», che
 * spiegava a ogni studio di mettere `v=spf1 include:register.it ~all` e un MX verso
 * `mail.register.it` sul dominio `bluecode-ltd.com`, con una colonna «Stato Deliverability» che
 * segnava «✓ Conforme» su tutte e tre le righe. Due difetti distinti:
 *
 *   1. il provider e il dominio erano quelli di un solo studio, scritti nel codice. Uno studio su
 *      Gmail o Microsoft 365 che seguiva queste righe rompeva la propria posta (regola 6: nessun
 *      server di terzi cablato; è anche il modo in cui `imap.register.it` è finito per imitazione
 *      nel campo host di una casella che non sta lì);
 *   2. «✓ Conforme» era un letterale nel JSX. Nessuno aveva interrogato il DNS: la spunta verde
 *      diceva conforme anche a dominio inesistente e zero record pubblicati (regola 7 — il
 *      frontend non racconta dati che non ha).
 *
 * Com'è: il dominio si ricava dall'indirizzo mittente che lo studio ha configurato, le righe
 * dicono quali record devono esistere e con quale forma, e i valori che solo il provider conosce
 * sono nominati come tali invece di essere indovinati. Lo stato non c'è: finché nessuno legge il
 * DNS, l'unica cosa vera da scrivere è dove andare a guardare.
 */
import React from 'react';
// La derivazione del dominio sta in `src/util/dominioMittente.ts` (radice del repo): è una
// funzione pura, e da lì la vede anche il presidio `src/postaRecordDns.test.ts`, perché il
// vitest del progetto esclude `frontend/**`.
import { dominioDaIndirizzo } from '../../../../src/util/dominioMittente';

interface Props {
  /** Indirizzo mittente configurato: da qui si ricava il dominio da sistemare. */
  smtpFromEmail: string;
  /** Casella in entrata, come ripiego quando il mittente non è ancora compilato. */
  imapUser: string;
  /** Host SMTP dello studio: è il provider a cui chiedere i valori di SPF e MX. */
  smtpHost: string;
}

/** La parte dopo la chiocciola del primo indirizzo compilato: vive in `dominioMittente.ts`. */
const CELLA: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'top' };
const MONO: React.CSSProperties = { ...CELLA, fontFamily: 'monospace' };

export function PannelloRecordDns({ smtpFromEmail, imapUser, smtpHost }: Props) {
  const dominio = dominioDaIndirizzo(smtpFromEmail, imapUser);
  const mittente = (smtpFromEmail || imapUser || '').trim();
  // Il provider è quello configurato: è l'unico che sa cosa scrivere in SPF e negli MX. Se il
  // campo host è vuoto lo si nomina per ruolo, senza sceglierne uno.
  const provider = (smtpHost || '').trim() || 'il provider della casella';

  const righe: Array<{ tipo: string; colore: string; nome: string; valore: string; nota: string }> = [
    {
      tipo: 'TXT (SPF)',
      colore: 'var(--cat-societario)',
      nome: dominio ? `@ (cioè ${dominio})` : '@ (la radice del dominio)',
      valore: 'v=spf1 include:<valore indicato dal provider> ~all',
      nota: `Autorizza i server che spediscono per il dominio. La parte «include:» va chiesta a ${provider}: sbagliarla peggiora la consegna invece di migliorarla.`,
    },
    {
      tipo: 'TXT (DKIM)',
      colore: 'var(--green)',
      nome: '<selettore indicato dal provider>._domainkey',
      valore: '<chiave pubblica fornita dal provider>',
      nota: 'Selettore e chiave li genera il provider quando si attiva la firma DKIM sulla casella: non esiste un valore valido in generale.',
    },
    {
      tipo: 'TXT (DMARC)',
      colore: 'var(--purple)',
      nome: '_dmarc',
      valore: `v=DMARC1; p=none; rua=mailto:${mittente || '<indirizzo dello studio>'}`,
      nota: 'Dice ai destinatari cosa fare quando SPF e DKIM non tornano, e dove mandare i rapporti. «p=none» osserva senza scartare: si irrigidisce dopo aver letto i rapporti.',
    },
    {
      tipo: 'MX (Mail)',
      colore: 'var(--amber)',
      nome: '@',
      valore: '<server di posta indicato dal provider> (priorità 10)',
      nota: `Riguarda la posta in arrivo. Il nome è quello che pubblica ${provider}: se il dominio è ospitato altrove, questo record punta lì e non alla casella configurata qui sopra.`,
    },
  ];

  return (
    <div style={{ background: 'var(--surface-3)', border: '1px solid var(--surface-1)', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cat-societario)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>🛡️ Record DNS del dominio (SPF, DKIM, DMARC, MX) — anti-spam e recapito</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
        {dominio ? (
          <>
            Perché le email spedite da <code>{mittente}</code> arrivino nella posta in arrivo dei clienti e non
            nello spam, il dominio <code>{dominio}</code> deve pubblicare questi record. Si aggiungono nel pannello
            di chi gestisce il dominio — che non è necessariamente chi ospita la casella.
          </>
        ) : (
          <>
            Compila l'indirizzo mittente qui sopra: da quello si ricava il dominio su cui vanno pubblicati i record
            che tengono le email fuori dallo spam.
          </>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, textAlign: 'left', color: 'var(--text)' }}>
          <thead>
            <tr style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '8px 10px' }}>Tipo Record</th>
              <th style={{ padding: '8px 10px' }}>Nome / Host</th>
              <th style={{ padding: '8px 10px' }}>Forma del valore</th>
              <th style={{ padding: '8px 10px' }}>A cosa serve</th>
            </tr>
          </thead>
          <tbody>
            {righe.map(riga => (
              <tr key={riga.tipo} style={{ borderBottom: '1px solid var(--pill-slate-bg)' }}>
                <td style={{ ...CELLA, fontWeight: 700, color: riga.colore }}>{riga.tipo}</td>
                <td style={MONO}>{riga.nome}</td>
                <td style={MONO}>{riga.valore}</td>
                <td style={{ ...CELLA, color: 'var(--muted)' }}>{riga.nota}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Regola 7 — dove finiva la colonna «Stato Deliverability» con le tre spunte verdi. */}
      <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.5 }}>
        BluMan non legge il DNS del dominio: qui non c'è nessuno stato «conforme», perché non è stato verificato
        niente. Lo stato vero si vede nel pannello del dominio, oppure con un controllo esterno dei record.
      </div>
    </div>
  );
}
