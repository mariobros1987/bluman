/**
 * §35 — il pannello dei record DNS non dichiara uno stato che nessuno ha verificato.
 *
 * Com'era, in `TabChannels.tsx`: una tabella intitolata «Configurazione Record DNS Dominio per
 * Register.it (Anti-Spam & Deliverability 100%)» con una colonna «Stato Deliverability» che
 * riportava «✓ Conforme» su tutte e tre le righe. Le spunte erano letterali nel JSX: nessuna
 * interrogazione del DNS, nessun dato dal database. Restavano verdi con il dominio scaduto, con
 * zero record pubblicati e con la posta che finiva nello spam — cioè esattamente nei casi in cui
 * quel pannello sarebbe servito (regola 7: il frontend non inventa dati che il database non ha).
 *
 * Il resto della tabella era il dominio e il provider di un solo studio, offerti come istruzioni
 * a tutti (regola 6). Il presidio sui nomi di terzi in `postaDiagnosi.test.ts` non li vedeva
 * perché scandiva solo `src/` e `api/`: ora comprende anche `frontend/src`.
 *
 * Qui si presidia il resto: che lo stato inventato non torni, che il dominio si ricavi da quello
 * che lo studio ha configurato, e che i valori che solo il provider conosce siano nominati come
 * tali invece di essere indovinati — un `include:` SPF sbagliato peggiora il recapito.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { soloCodice } from './util/soloCodice.js';
import { dominioDaIndirizzo } from './util/dominioMittente.js';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PANNELLO = 'frontend/src/components/settings/PannelloRecordDns.tsx';
const MODULO = 'frontend/src/components/settings/TabChannels.tsx';

const codicePannello = soloCodice(readFileSync(join(RADICE, PANNELLO), 'utf8'));
const codiceModulo = soloCodice(readFileSync(join(RADICE, MODULO), 'utf8'));

describe('§35 — il dominio dei record si ricava dagli indirizzi dello studio', () => {
  it('prende il dominio dall\'indirizzo mittente', () => {
    expect(dominioDaIndirizzo('comunicazioni@studio-esempio.it')).toBe('studio-esempio.it');
  });

  it('ripiega sulla casella in entrata quando il mittente non è compilato', () => {
    expect(dominioDaIndirizzo('', 'posta@studio-esempio.it')).toBe('studio-esempio.it');
  });

  it('normalizza spazi e maiuscole, perché nel campo ci finiscono entrambi', () => {
    expect(dominioDaIndirizzo('  Posta@Studio-Esempio.IT ')).toBe('studio-esempio.it');
  });

  it('senza indirizzi utilizzabili non inventa un dominio', () => {
    // Il pannello, in questo caso, chiede di compilare il mittente: una stringa che sembra un
    // dominio e non lo è finirebbe in istruzioni da seguire nel pannello del registrar.
    expect(dominioDaIndirizzo('', '')).toBeNull();
    expect(dominioDaIndirizzo('senza-chiocciola')).toBeNull();
    expect(dominioDaIndirizzo('posta@localhost')).toBeNull();
    expect(dominioDaIndirizzo('posta@.it', 'posta@studio.')).toBeNull();
  });
});

describe('§35 — nessuno stato di conformità dichiarato senza averlo letto', () => {
  it('il pannello non dichiara nessuna riga «conforme»', () => {
    // Regola 7. Se un giorno lo stato serve davvero, si prende da una rotta che risolve TXT e MX
    // e lo restituisce: allora la parola potrà tornare, insieme al dato che la sostiene. La riga
    // che spiega di non aver letto il DNS scrive «conforme» in minuscolo: non è una dichiarazione
    // di stato, è la sua assenza detta a parole.
    expect(codicePannello).not.toMatch(/✓\s*Conforme/i);
    expect(codicePannello).not.toMatch(/\bConforme\b/);
    expect(codicePannello).not.toMatch(/Deliverability 100/i);
  });

  it('il pannello dice esplicitamente che il DNS non è stato letto', () => {
    expect(codicePannello).toMatch(/non legge il DNS/i);
  });

  it('la tabella non è più dentro TabChannels: il modulo monta il pannello', () => {
    expect(codiceModulo).toContain('<PannelloRecordDns');
    expect(codiceModulo).not.toMatch(/Stato Deliverability/i);
  });
});

describe('§35 — i valori che solo il provider conosce non vengono indovinati', () => {
  it('SPF e MX rimandano al provider invece di proporre un valore', () => {
    // Un `include:` SPF sbagliato non è un consiglio inutile: autorizza i server sbagliati e
    // peggiora il recapito rispetto a non avere il record.
    expect(codicePannello).toContain('include:<valore indicato dal provider>');
    expect(codicePannello).toContain('<server di posta indicato dal provider>');
    expect(codicePannello).not.toMatch(/include:[a-z0-9.-]+\.[a-z]{2,}/);
  });

  it('il DMARC si compone con l\'indirizzo dello studio, che è un dato che c\'è', () => {
    expect(codicePannello).toContain('v=DMARC1; p=none; rua=mailto:');
  });

  it('il pannello riceve gli indirizzi configurati, non li cerca da sé', () => {
    expect(codicePannello).toContain('smtpFromEmail');
    expect(codicePannello).toContain('imapUser');
    expect(codicePannello).toContain('smtpHost');
  });
});

describe('§35 — i segnaposto dei campi non nominano il provider di uno studio', () => {
  it('i segnaposto host indicano il ruolo del valore, non un server esistente', () => {
    // Il segnaposto è un'istruzione: `imap.register.it` scritto lì è il modo in cui quel nome è
    // finito nel campo host di una casella che non sta su quel provider.
    const segnaposto = [...codiceModulo.matchAll(/placeholder="([^"]+)"/g)].map(m => m[1] ?? '');
    expect(segnaposto.length).toBeGreaterThan(5);
    for (const valore of segnaposto) {
      expect(valore.toLowerCase()).not.toMatch(/register\.it|securemail\.pro|bluecode/);
    }
  });
});
