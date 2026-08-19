import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regola 6 di `.agents/AGENTS.md`: nessuna credenziale reale nel codice versionato.
 *
 * Questo test esiste perché la falla si è già ripresentata una volta spostandosi. La
 * Fase 0 aveva rimosso la tabella email/password da `src/server.ts`, ma la stessa tabella
 * continuava a vivere in `frontend/src/api/client.ts` — e da lì finiva nel bundle Vite
 * servito da Vercel, cioè in JavaScript leggibile da chiunque aprisse la pagina. C'erano
 * anche tre password universali (`password123`, `Studio2026!`, `admin2026!`) accettate per
 * qualunque studio, e una condizione `!password || ...` che faceva passare la stringa
 * vuota.
 *
 * Il test guarda i sorgenti, non il bundle: un valore che non è nei sorgenti non può
 * essere nel bundle, e il controllo funziona senza dover eseguire la build.
 */

// `fileURLToPath` e non `new URL(...).pathname`: su Windows quest'ultimo produce
// `/C:/Users/...`, un percorso che `readdirSync` non risolve.
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Estensioni che finiscono compilate nel bundle o eseguite sul server. */
const ESTENSIONI = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const CARTELLE_DA_ISPEZIONARE = ['src', 'frontend/src', 'api'];

const CARTELLE_DA_SALTARE = new Set(['node_modules', 'dist', 'build', '.git', 'graphify-out']);

/**
 * La regola 6 vieta le credenziali in chiaro anche nei file `.md`, e per una ragione
 * concreta: raccontare quale password è stata rimossa la lascia leggibile nel repository
 * esattamente come prima. Se quella password è ancora in uso su un account che nessuno ha
 * cambiato, la documentazione è la falla.
 *
 * Sono i file di documentazione del progetto, non quelli di `openstamanager-reference/`,
 * che è materiale di terze parti solo consultato.
 */
const DOC_DA_ISPEZIONARE = [
  'README.md',
  'BluMan_piano_di_sviluppo.md',
  'BluMan_analisi_professionale.md',
  'ISTRUZIONI_INSTALLAZIONE.md',
  'ISTRUZIONI_PER_IA.md',
  'GUIDA_CONFIGURAZIONE_CANALI.md',
  'GUIDA_META_WHATSAPP_INTEGRAZIONE.md',
  '.agents/AGENTS.md',
];

/**
 * Le credenziali che erano cablate nel codice. Ognuna apriva un account reale: restano
 * qui come stringhe da cercare, non come valori da usare.
 */
const CREDENZIALI_VIETATE = [
  'password123',
  'Studio2026!',
  'admin2026!',
  'operator123',
  'RegisterSecret2026!',
  // Token di sessione finti: non sono JWT verificabili, servivano solo a far sembrare
  // autenticata una richiesta che non lo era.
  'jwt_advisor_mock_123',
  'jwt_magic_mock_456',
];

function fileDaControllare(cartella: string, acc: string[] = []): string[] {
  let voci: string[];
  try {
    voci = readdirSync(cartella);
  } catch {
    return acc; // cartella opzionale (es. `api/` non esiste in tutti i checkout)
  }
  for (const voce of voci) {
    if (CARTELLE_DA_SALTARE.has(voce)) continue;
    const percorso = join(cartella, voce);
    if (statSync(percorso).isDirectory()) {
      fileDaControllare(percorso, acc);
    } else if (ESTENSIONI.has(extname(voce))) {
      acc.push(percorso);
    }
  }
  return acc;
}

describe('regola 6 — nessuna credenziale in chiaro nel codice versionato', () => {
  const file = CARTELLE_DA_ISPEZIONARE.flatMap(c => fileDaControllare(join(RADICE, c)));

  it('trova i sorgenti da ispezionare', () => {
    // Se la scansione tornasse vuota il test passerebbe senza aver controllato niente.
    expect(file.length).toBeGreaterThan(20);
  });

  it.each(CREDENZIALI_VIETATE)('la stringa %s non compare in nessun sorgente', credenziale => {
    const colpevoli: string[] = [];

    for (const percorso of file) {
      // Il file dei test è l'unico posto dove queste stringhe devono comparire: sono i
      // valori che stiamo cercando.
      if (percorso.endsWith('credenziali.test.ts') || percorso.endsWith('server.test.ts')) continue;

      const contenuto = readFileSync(percorso, 'utf8');
      const righe = contenuto.split('\n');
      righe.forEach((riga, i) => {
        if (!riga.includes(credenziale)) return;
        // Un commento che spiega *perché* una credenziale è stata rimossa è
        // documentazione, non una credenziale utilizzabile.
        const ripulita = riga.trim();
        const eCommento = ripulita.startsWith('//') || ripulita.startsWith('*') || ripulita.startsWith('/*');
        if (eCommento) return;
        colpevoli.push(`${percorso.replace(RADICE, '')}:${i + 1}`);
      });
    }

    expect(colpevoli, `credenziale "${credenziale}" ancora presente in: ${colpevoli.join(', ')}`).toEqual([]);
  });

  it('nessun ramo di login accetta una password vuota', () => {
    // `if (!password || ...)` è la forma esatta che permetteva di entrare senza password.
    const colpevoli: string[] = [];
    for (const percorso of file) {
      if (percorso.endsWith('credenziali.test.ts')) continue;
      const contenuto = readFileSync(percorso, 'utf8');
      if (/!password\s*\|\|/.test(contenuto)) colpevoli.push(percorso.replace(RADICE, ''));
    }
    expect(colpevoli).toEqual([]);
  });
});

describe('regola 6 — nessuna credenziale in chiaro nella documentazione `.md`', () => {
  /** Solo i file che esistono davvero: l'elenco sopravvive a una rinomina senza rompersi. */
  const doc = DOC_DA_ISPEZIONARE.map(d => join(RADICE, d)).filter(p => existsSync(p));

  it('trova i file di documentazione da ispezionare', () => {
    expect(doc.length).toBeGreaterThanOrEqual(4);
  });

  it.each(CREDENZIALI_VIETATE)('la stringa %s non compare in nessun `.md`', credenziale => {
    const colpevoli: string[] = [];

    for (const percorso of doc) {
      const righe = readFileSync(percorso, 'utf8').split('\n');
      righe.forEach((riga, i) => {
        // Qui non c'è l'esenzione per i commenti che vale per i sorgenti: in un `.md` è
        // tutto prosa, e la prosa è precisamente il posto dove la tentazione di
        // trascrivere la credenziale «solo per spiegare» si presenta.
        if (riga.includes(credenziale)) colpevoli.push(`${percorso.replace(RADICE, '')}:${i + 1}`);
      });
    }

    expect(
      colpevoli,
      `credenziale "${credenziale}" scritta in chiaro in: ${colpevoli.join(', ')}. ` +
        'Rimandare a src/credenziali.test.ts invece di trascriverla.',
    ).toEqual([]);
  });
});
