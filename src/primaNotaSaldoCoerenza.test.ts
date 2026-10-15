// Chi ha il diritto di scrivere un saldo, e chi di creare un movimento di Prima Nota.
//
// Questo file non prova un comportamento: prova una **regola di forma**, ed è l'unico presidio che
// copre il percorso che non è ancora stato scritto. La storia che lo giustifica è nei numeri: delle
// dieci strade che scrivono un movimento, sei lasciavano il saldo fermo o lo muovevano sul conto
// sbagliato — il versamento F24, i due pagamenti ai fornitori, l'import CSV, il rimborso per Nota di
// Credito, l'incasso senza conto indicato. Nessuna di quelle sei faceva rumore: il conto mostrava un
// numero che non tornava con i propri movimenti, e per accorgersene bisognava rifare il conto a mano.
//
// I test dei singoli percorsi (uno per ciascuno di quei sei) tengono chiusi i difetti **conosciuti**.
// Questo tiene chiusa la classe: un percorso nuovo che crea un movimento senza passare da
// `services/primaNotaMovimento.ts` fallisce qui, prima di poter sbagliare in silenzio. È lo stesso
// mestiere che fa `p0HtmlUploadPolicy.test.ts` con i sink HTML, e per la stessa ragione: la difesa
// che manca è sempre quella che nessuno ha ancora scritto.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** I commenti si tolgono **prima** di cercare: qui i commenti nominano di continuo ciò che si cerca. */
const senzaCommenti = (percorso: string) =>
  fs.readFileSync(percorso, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

function tsSotto(cartella: string, acc: string[] = []): string[] {
  let voci: string[];
  try {
    voci = fs.readdirSync(cartella);
  } catch {
    return acc;
  }
  for (const voce of voci) {
    if (voce === 'node_modules' || voce === 'dist') continue;
    const percorso = path.join(cartella, voce);
    if (fs.statSync(percorso).isDirectory()) tsSotto(percorso, acc);
    else if (/\.ts$/.test(voce) && !/\.test\.ts$/.test(voce)) acc.push(percorso);
  }
  return acc;
}

/** Il percorso relativo con le barre in avanti, come si scrive in un elenco. */
const relativo = (percorso: string) => path.relative(root, percorso).split(path.sep).join('/');

const FILE = tsSotto(path.join(root, 'src'));

/**
 * Gli unici file che possono nominare la colonna del saldo, e perché ognuno ha il diritto di farlo.
 *
 * `primaNotaMovimento.ts` perché è il posto dove movimento e saldo si scrivono insieme;
 * `contabilitaContiReport.ts` perché è l'unica lettura della colonna — quella che la verifica e,
 * se serve, la riporta al valore dei movimenti.
 *
 * Un terzo file in questo elenco vuol dire che il saldo ha ricominciato a essere scritto a mano in
 * un posto in più. Aggiungerlo è una decisione, e va presa qui, non di sfuggita.
 */
const SCRITTURE_SALDO_AMMESSE = [
  'src/routes/contabilitaContiReport.ts',
  'src/services/primaNotaMovimento.ts',
];

/** L'unico file che può creare o cancellare un movimento di Prima Nota. */
const CREAZIONI_MOVIMENTO_AMMESSE = ['src/services/primaNotaMovimento.ts'];

describe('il saldo dei conti ha una sola fonte di verità', () => {
  it('la camminata dei file trova davvero il codice (la rete di sicurezza del test stesso)', () => {
    // Se un giorno l'albero si spostasse o il filtro delle estensioni sbagliasse, gli elenchi qui
    // sotto tornerebbero vuoti e il confronto passerebbe — con un messaggio che parla di saldi
    // invece che di cartelle. Questa riga dice subito quale delle due cose è andata storta.
    expect(FILE.length).toBeGreaterThan(50);
    expect(FILE.map(relativo)).toContain('src/services/primaNotaMovimento.ts');
  });

  it('il saldo è scritto solo dove si scrivono insieme movimento e saldo', () => {
    const conSaldo = FILE.filter((f) => senzaCommenti(f).includes('saldoAttuale'))
      .map(relativo)
      .sort();

    expect(conSaldo).toEqual([...SCRITTURE_SALDO_AMMESSE].sort());
  });

  it('nessun percorso crea o cancella un movimento fuori dal servizio che muove il saldo', () => {
    // `create(` e `delete(` — non `deleteMany(`: la cancellazione in blocco è la fine di un tenant
    // o la pulizia di dati di prova, dove i conti se ne vanno insieme ai movimenti. `createMany(` sì,
    // invece: è un modo di creare movimenti in massa, e in massa il saldo lo dimenticherebbe uguale.
    const creano = FILE.filter((f) => /movimentoPrimaNota\.(create|delete|createMany)\(/.test(senzaCommenti(f)))
      .map(relativo)
      .sort();

    expect(creano).toEqual([...CREAZIONI_MOVIMENTO_AMMESSE].sort());
  });
});
