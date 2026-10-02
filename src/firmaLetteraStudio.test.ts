import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Presidio dell'unificazione §52 — **lo studio e il portale leggono la stessa riga**.
 *
 * Il 02/10/2026 il portale dava per firmata la lettera d'incarico del progetto «prova server»
 * (creato quel giorno) e il fascicolo dello studio, sulla stessa lettera, diceva «IN ATTESA».
 * Non erano due bug: erano due letture di fonti diverse.
 *
 *  - Il **portale** legge `firma_elettronica`, la riga che le rotte di firma scrivono davvero.
 *  - Lo **studio** leggeva `EngagementLetter.statoFirma` — una tabella che **nessuna rotta
 *    scrive**: in produzione ha zero righe. Il suo default `in_attesa` non è uno stato, è
 *    l'unico valore che quella colonna abbia mai avuto. Il commento che accompagnava quella
 *    lettura diceva che la scrive «solo il flusso OTP in firma.ts»: era falso, e nessun test
 *    confrontava la lettura con uno scrittore, perché uno scrittore non c'era.
 *
 * Ora lo studio legge la stessa riga del portale — `firma_elettronica`, ambito
 * `engagement_letter`, `riferimentoId` = il progetto — e questo file tiene fermo il fatto.
 * Non confronta le stringhe per pedanteria: la contraddizione qui non dà un errore, dà una
 * schermata che afferma una cosa falsa su un atto legale, e può restare invisibile per mesi.
 */

const RADICE = path.resolve(import.meta.dirname, '..');

const leggi = (...pezzi: string[]) => readFileSync(path.join(RADICE, ...pezzi), 'utf8');

/**
 * Il sorgente senza commenti.
 *
 * Serve perché la prosa attorno a questo codice **parla** della lettura rimossa — «qui c'era
 * `preventivi: { include: { engagementLetter … } }`» — ed è giusto che lo faccia: senza,
 * fra sei mesi nessuno saprebbe perché è stata tolta. Il presidio però deve guardare il
 * codice, non i commenti, se no vieta di raccontare la correzione. Richiede `//` non
 * preceduto da `:`, così un `https://` dentro una stringa non viene mangiato.
 */
function senzaCommenti(sorgente: string): string {
  return sorgente
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Il corpo di un metodo: dalla sua firma fino alla graffa di chiusura a due spazi. */
function corpoMetodo(sorgente: string, firma: string): string {
  const inizio = sorgente.indexOf(firma);
  expect(inizio, `metodo «${firma}» non trovato: il presidio non sta guardando niente`).toBeGreaterThan(-1);
  const resto = sorgente.slice(inizio);
  const fine = resto.indexOf('\n  }\n');
  return fine === -1 ? resto : resto.slice(0, fine);
}

/** Tutti i `.ts`/`.tsx` sotto le cartelle indicate, saltando ciò che non è sorgente nostro. */
function sorgenti(...cartelle: string[]): string[] {
  const fuori: string[] = [];
  const salta = new Set(['node_modules', 'dist', 'build', '.git']);
  const scendi = (dir: string) => {
    for (const voce of readdirSync(dir, { withFileTypes: true })) {
      if (salta.has(voce.name)) continue;
      const pieno = path.join(dir, voce.name);
      if (voce.isDirectory()) scendi(pieno);
      else if (/\.tsx?$/.test(voce.name)) fuori.push(pieno);
    }
  };
  for (const c of cartelle) scendi(path.join(RADICE, c));
  return fuori;
}

describe('§52 — la lettera d\'incarico: lo studio legge la firma, non una tabella vuota', () => {
  const prismaApp = leggi('src', 'adapters', 'prisma', 'prismaApp.ts');

  it('getProgetto legge firma_elettronica sul progetto e sul tenant', () => {
    const corpo = senzaCommenti(corpoMetodo(prismaApp, 'async getProgetto('));

    // La stessa riga che legge il portale: ambito `engagement_letter`, riferimento = il progetto.
    // Il riferimento è ciò che rende la domanda «questo incarico è firmato?» una domanda con
    // risposta; senza, la firma non dice su cosa è stata apposta (le righe del 08/09/2026).
    expect(corpo).toMatch(/firmaElettronica\.findFirst/);
    expect(corpo).toMatch(/ambito:\s*'engagement_letter'/);
    expect(corpo).toMatch(/riferimentoId:\s*id/);

    // E sul tenant: una firma di un altro studio non deve comparire nel fascicolo di questo.
    expect(corpo).toMatch(/tenantId:\s*this\.tenantId/);
  });

  it('getProgetto non legge più EngagementLetter.statoFirma', () => {
    const corpo = senzaCommenti(corpoMetodo(prismaApp, 'async getProgetto('));
    expect(corpo).not.toMatch(/engagementLetter/i);
    expect(corpo).not.toMatch(/statoFirma/);
  });

  it('la tabella engagement_letter resta senza scrittori: è il motivo per cui non si legge', () => {
    // Se un domani una rotta comincia a scrivere `EngagementLetter.statoFirma`, questo test
    // rosseggia — ed è il momento giusto per decidere: o si aggiorna quella colonna E la si
    // legge (tornando a due fonti), oppure la si elimina. Quello che non si può fare è
    // lasciar credere che sia la fonte della verità mentre nessuno la aggiorna.
    const scrittori: string[] = [];
    for (const file of sorgenti('src')) {
      const codice = senzaCommenti(readFileSync(file, 'utf8'));
      if (/prisma\.engagementLetter\.(create|update|upsert|updateMany)/.test(codice)) {
        scrittori.push(path.relative(RADICE, file));
      }
    }
    expect(scrittori, `EngagementLetter.statoFirma non è scritta da nessuna rotta: ${scrittori.join(', ')}`).toEqual([]);
  });

  it('il fascicolo prende la firma da `firmaLettera`, non dai preventivi', () => {
    const dettaglio = senzaCommenti(leggi('frontend', 'src', 'pages', 'ProjectDetail.tsx'));
    expect(dettaglio).toMatch(/dbRes\.firmaLettera/);
    // La relazione Preventivo → EngagementLetter era il tramite: senza di essa non c'era
    // niente da leggere, ed è da lì che veniva il «IN ATTESA» su lettere firmate.
    expect(dettaglio).not.toMatch(/dbRes\.preventivi/);
    expect(dettaglio).not.toMatch(/pv\.engagementLetter/);
  });

  it('lo storico contrattuale afferma la firma solo se la riga di firma c\'è', () => {
    const tab = senzaCommenti(leggi('frontend', 'src', 'components', 'projectDetail', 'StoricoContrattiTab.tsx'));
    // `project.firmaLettera` è la riga: senza, non si dice «firmata» — nemmeno se `statoFirma`
    // dicesse `completata`. Due condizioni, non una, perché una firma mostrata senza la sua
    // evidenza è la cosa che questa unificazione è nata per togliere.
    expect(tab).toMatch(/project\.firmaLettera/);
    expect(tab).toMatch(/project\.statoFirma === 'completata' && firma !== null/);
  });
});
