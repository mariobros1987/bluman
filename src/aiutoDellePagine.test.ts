// Il «?» accanto al titolo di ogni pagina apre una scheda dell'Aiuto: ogni scheda nominata dalla
// mappa del frontend deve esistere davvero in `docs/manuale/`. Sta qui, fra i test del backend,
// perché deve leggere il disco.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const radice = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manuale = path.join(radice, 'docs', 'manuale');
// La mappa si legge come testo: il backend non può importare un file del frontend (rootDir), e
// qui serve solo l'elenco degli slug — le stringhe fatte come il nome di una scheda, «NN-nome».
const sorgente = fs.readFileSync(path.join(radice, 'frontend', 'src', 'utils', 'aiutoDellaPagina.ts'), 'utf8');
const SCHEDE_AIUTO_DELLE_PAGINE = [...sorgente.matchAll(/:\s*'(\d{2}-[a-z0-9-]+)'/g)].map((m) => m[1] as string);

describe('le schede dell’Aiuto collegate alle pagine', () => {
  it('la mappa non è vuota', () => {
    expect(SCHEDE_AIUTO_DELLE_PAGINE.length).toBeGreaterThan(15);
  });

  it.each([...new Set(SCHEDE_AIUTO_DELLE_PAGINE)])('%s esiste nel manuale', (slug) => {
    expect(fs.existsSync(path.join(manuale, `${slug}.md`))).toBe(true);
  });
});
