// Note della beta — le regole pure, usate dal server e dalla pagina.
//
// Una nota si attacca a una PAGINA. L'indirizzo esatto cambia da un progetto all'altro
// («/projects/6a3b…»), quindi per raggruppare serve la sua forma generale («/projects/:id»):
// la calcola una funzione sola, così il pulsante della pagina e l'elenco di raccolta parlano
// della stessa cosa.

export const TIPI_NOTA_BETA = ['errore', 'miglioramento', 'domanda'] as const;
export type TipoNotaBeta = (typeof TIPI_NOTA_BETA)[number];
export const STATI_NOTA_BETA = ['aperta', 'risolta'] as const;
export type StatoNotaBeta = (typeof STATI_NOTA_BETA)[number];

export const LUNGHEZZA_MASSIMA_NOTA = 2000;
export const LUNGHEZZA_MINIMA_NOTA = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La forma generale di un indirizzo: i pezzi che sono un identificativo (un UUID o un numero)
 * diventano «:id». Query e ancora si tolgono; un indirizzo vuoto è la Dashboard («/»).
 * Gli altri pezzi restano come sono: «/aiuto/05-fatture-sdi» è una scheda precisa, non un id.
 */
export function paginaGenerale(percorso: string | null | undefined): string {
  const senzaCoda = String(percorso ?? '').split(/[?#]/)[0] ?? '';
  const pezzi = senzaCoda.split('/').filter(Boolean).map((p) => (UUID.test(p) || /^\d+$/.test(p) ? ':id' : p));
  return `/${pezzi.join('/')}`;
}

export function eTipoNotaBeta(v: unknown): v is TipoNotaBeta {
  return typeof v === 'string' && (TIPI_NOTA_BETA as readonly string[]).includes(v);
}
export function eStatoNotaBeta(v: unknown): v is StatoNotaBeta {
  return typeof v === 'string' && (STATI_NOTA_BETA as readonly string[]).includes(v);
}

/** Chi vede l'elenco completo e segna una nota «risolta»: chi risponde dello studio e la piattaforma. */
export function puoGestireNoteBeta(ruolo: string | null | undefined): boolean {
  return ruolo === 'advisor' || ruolo === 'super_admin';
}

/** Chi può scrivere e leggere le note di una pagina: chi lavora nello studio. Il cliente del portale no. */
export function puoScrivereNoteBeta(ruolo: string | null | undefined): boolean {
  return ruolo === 'super_admin' || ruolo === 'advisor' || ruolo === 'collaboratore_interno' || ruolo === 'collaboratore_esterno';
}

export const ETICHETTA_TIPO_NOTA: Record<TipoNotaBeta, string> = {
  errore: 'Errore',
  miglioramento: 'Miglioramento',
  domanda: 'Domanda',
};

/**
 * Le note in testo semplice (Markdown), raggruppate per pagina: è ciò che «Copia tutto» mette negli
 * appunti, pronto da incollare a chi deve correggere.
 */
export function noteBetaInTesto(
  note: ReadonlyArray<{ pagina: string; percorso: string; tipo: string; testo: string; stato: string; autoreNome: string; createdAt: string | Date }>,
  titoloDellaPagina: (pagina: string) => string = (p) => p,
): string {
  if (note.length === 0) return 'Nessuna nota della beta.';
  const perPagina = new Map<string, typeof note[number][]>();
  for (const n of note) {
    const elenco = perPagina.get(n.pagina);
    if (elenco) elenco.push(n);
    else perPagina.set(n.pagina, [n]);
  }
  const righe: string[] = [`# Note della beta (${note.length})`, ''];
  for (const [pagina, elenco] of [...perPagina.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const titolo = titoloDellaPagina(pagina);
    righe.push(`## ${titolo === pagina ? pagina : `${titolo} (${pagina})`}`);
    for (const n of elenco) {
      const giorno = new Date(n.createdAt).toISOString().slice(0, 10);
      const tipo = eTipoNotaBeta(n.tipo) ? ETICHETTA_TIPO_NOTA[n.tipo] : n.tipo;
      const dove = n.percorso !== n.pagina ? ` — indirizzo: ${n.percorso}` : '';
      const risolta = n.stato === 'risolta' ? ' [RISOLTA]' : '';
      righe.push(`- **${tipo}**${risolta} (${n.autoreNome}, ${giorno})${dove}`);
      for (const riga of n.testo.split('\n')) righe.push(`  ${riga}`);
    }
    righe.push('');
  }
  return righe.join('\n').trimEnd();
}
