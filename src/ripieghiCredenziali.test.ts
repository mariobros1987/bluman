import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Autonomia dei canali per studio: nessun ripiego di credenziale sulle variabili d'ambiente.
 *
 * Perché esiste questo test. Le credenziali dei canali (SMTP, IMAP, WhatsApp, Telegram) vivono
 * nella riga `Tenant` e si impostano da Impostazioni → Canali. Per molto tempo il codice non le
 * ha lette: ogni invio partiva da `process.env.*`, cioè dall'account di un solo studio per tutti
 * i tenant. Su un'installazione multi-studio questo significa che il messaggio di firma di un
 * cliente parte dal numero di un altro studio, con la posta di un altro.
 *
 * L'ordine è stato invertito (prima la riga Tenant), ma era rimasto un ripiego: uno studio
 * **senza** credenziali proprie inviava comunque, con l'identità della piattaforma, e
 * l'interfaccia lo presentava come configurato. Un canale non configurato deve risultare spento.
 *
 * Il test guarda i sorgenti e ignora le righe di commento: i commenti che raccontano il ripiego
 * rimosso sono documentazione utile e devono poterlo nominare.
 */

// `fileURLToPath` e non `new URL(...).pathname`: su Windows quest'ultimo produce `/C:/Users/...`.
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CARTELLE_DA_ISPEZIONARE = ['src', 'api'];
const CARTELLE_DA_SALTARE = new Set(['node_modules', 'dist', 'build', '.git', 'graphify-out']);
const ESTENSIONI = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

/**
 * Variabili che non devono più comparire nel codice come fonte di una credenziale.
 *
 * `SMTP_INSECURE_TLS` non è in questo elenco di proposito: non è una credenziale ma una
 * politica TLS (accettare un certificato self-signed su un server di posta interno), e come
 * tale resta una scelta di piattaforma.
 */
const VARIABILI_VIETATE = [
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'SMTP_PORT',
  'SMTP_SERVERNAME',
  'IMAP_HOST',
  'IMAP_USER',
  'IMAP_PASS',
  'WHATSAPP_ACCESS_TOKEN',
  'WA_PHONE_ID',
  'WA_ACCESS_TOKEN',
  // WhatsApp in ingresso: erano di piattaforma perché la Callback URL di Meta è per
  // applicazione, quindi esisteva una sola app. Ora ogni studio ha la sua (App ID, App Secret,
  // Verify Token, template OTP sulla riga `Tenant`) e l'handshake si risolve dallo slug nel
  // path. Una variabile di piattaforma reintrodurrebbe l'identità unica per tutti gli studi:
  // il messaggio di un cliente autenticato con il segreto di un altro.
  'WA_VERIFY_TOKEN',
  'WA_APP_SECRET',
  'WA_OTP_TEMPLATE',
  'WA_OTP_TEMPLATE_LANG',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_BOT_USERNAME',
];

/** Una riga è un commento se, ripulita, inizia con `//`, `*` o `/*`. */
function eCommento(riga: string): boolean {
  const s = riga.trim();
  return s.startsWith('//') || s.startsWith('*') || s.startsWith('/*');
}

function fileSorgente(cartella: string, acc: string[] = []): string[] {
  let voci: string[];
  try {
    voci = readdirSync(cartella);
  } catch {
    return acc; // `api/` può non esistere in tutti i checkout
  }
  for (const voce of voci) {
    if (CARTELLE_DA_SALTARE.has(voce)) continue;
    const percorso = join(cartella, voce);
    if (statSync(percorso).isDirectory()) {
      fileSorgente(percorso, acc);
    } else if (ESTENSIONI.has(extname(voce)) && !voce.endsWith('.test.ts')) {
      acc.push(percorso);
    }
  }
  return acc;
}

describe('nessun ripiego di credenziale sulle variabili d\'ambiente', () => {
  const file = CARTELLE_DA_ISPEZIONARE.flatMap(c => fileSorgente(join(RADICE, c)));

  it('ispeziona un numero plausibile di sorgenti (la ricerca non è vuota per errore)', () => {
    expect(file.length).toBeGreaterThan(50);
  });

  for (const variabile of VARIABILI_VIETATE) {
    it(`\`process.env.${variabile}\` non compare in una riga di codice`, () => {
      const colpevoli: string[] = [];
      for (const percorso of file) {
        const righe = readFileSync(percorso, 'utf8').split(/\r?\n/);
        righe.forEach((riga, indice) => {
          if (eCommento(riga)) return;
          if (riga.includes(`process.env.${variabile}`)) {
            colpevoli.push(`${percorso.replace(RADICE, '').replace(/\\/g, '/')}:${indice + 1}`);
          }
        });
      }
      expect(
        colpevoli,
        `La credenziale dello studio non deve ripiegare sull'ambiente. Righe da correggere:\n` +
          colpevoli.map(c => `  ${c}`).join('\n'),
      ).toEqual([]);
    });
  }
});
