import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CARTELLA_UPLOADS,
  mimeDaEstensione,
  nomeFileSicuro,
  nomeFileValido,
  uploadDocumento,
} from './storageService.js';

// §21 — il MIME dichiarato a Supabase Storage segue l'estensione reale del file:
// prima era `application/pdf` per ogni upload e le anteprime dei formati diversi
// dal PDF non si aprivano.
describe('mimeDaEstensione — il MIME dichiarato segue l\'estensione', () => {
  it('assegna application/pdf ai PDF', () => {
    expect(mimeDaEstensione('contratto.pdf')).toBe('application/pdf');
  });

  it('assegna il MIME corretto ai formati più comuni negli allegati', () => {
    expect(mimeDaEstensione('atto.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(mimeDaEstensione('scansione.jpg')).toBe('image/jpeg');
    expect(mimeDaEstensione('scansione.jpeg')).toBe('image/jpeg');
    expect(mimeDaEstensione('tabella.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(mimeDaEstensione('firmato.p7m')).toBe('application/pkcs7-mime');
    expect(mimeDaEstensione('nota.eml')).toBe('message/rfc822');
  });

  it('è insensibile alle maiuscole', () => {
    expect(mimeDaEstensione('ATTO.PDF')).toBe('application/pdf');
    expect(mimeDaEstensione('foto.JPG')).toBe('image/jpeg');
  });

  it('i tipi sconosciuti ricadono su octet-stream: il browser li scarica senza interpretarli', () => {
    expect(mimeDaEstensione('archivio.bin')).toBe('application/octet-stream');
    expect(mimeDaEstensione('senzaestensione')).toBe('application/octet-stream');
  });
});

// L'invariante che tiene allineate scrittura e lettura: ogni nome prodotto da
// `nomeFileSicuro` (upload) deve superare `nomeFileValido` (serve di /uploads).
// La divergenza fra le due metà era il guasto originale.
describe('coppia scrittura/lettura dei nomi file', () => {
  it('ogni nome sanificato da nomeFileSicuro supera nomeFileValido', () => {
    const campioni = [
      'documento.pdf',
      '../../etc/passwd',
      'file con spazi.docx',
      'foto:studio.jpg',
      'ok_.-123.txt',
      'äöüß.png',
      'a\\b\\c.zip',
    ];
    for (const campione of campioni) {
      const sicuro = `${Date.now()}_${nomeFileSicuro(campione)}`;
      expect(nomeFileValido(sicuro)).toBe(true);
    }
  });

  it('nomeFileValido rifiuta traversal, separatori e nomi vuoti o troppo lunghi', () => {
    expect(nomeFileValido('..')).toBe(false);
    expect(nomeFileValido('../fuga.pdf')).toBe(false);
    expect(nomeFileValido('a/b.pdf')).toBe(false);
    expect(nomeFileValido('a\\b.pdf')).toBe(false);
    expect(nomeFileValido('')).toBe(false);
    expect(nomeFileValido('a'.repeat(256))).toBe(false);
  });

  it('i punti doppi nel nome d\'origine non sopravvivono alla sanificazione', () => {
    // Il punto da solo è ammesso: senza il collasso, «../../etc/passwd» diventerebbe
    // «.._.._etc_passwd» — valido per i caratteri ma rifiutato in lettura, e il file
    // scritto resterebbe irrecuperabile.
    expect(nomeFileSicuro('../../etc/passwd')).not.toContain('..');
    expect(nomeFileSicuro('report..finale.pdf')).not.toContain('..');
  });
});

// Regola 5: nessun ripiego in silenzio. Per tutto agosto Supabase Storage ha risposto
// non-ok e `uploadDocumento` scivolava nel fallback locale senza una riga di log: i
// file finivano sul disco dell'API e nessuno sapeva perché il bucket restasse vuoto.
// Questo test blinda il warn che ora accompagna quel passaggio — senza status HTTP nei
// log, l'incidente si ripresenterebbe uguale a sé stesso.
describe('uploadDocumento — il fallback locale non è più silenzioso', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let fileScritto: string | null = null;

  beforeEach(() => {
    // Chiavi configurate ma Storage che risponde non-ok: la forma esatta del guasto
    // di agosto, che non solleva eccezione e prima cadeva nel ripiego senza dirlo.
    vi.stubEnv('SUPABASE_URL', 'https://test-supabase.local');
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'chiave-di-test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 507 }));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    // Il fallback scrive davvero su disco: portiamo via il file di prova e ripristiniamo
    // env, fetch e spy, così nessun altro test vede il mondo di questo.
    if (fileScritto) {
      fs.rmSync(path.join(CARTELLA_UPLOADS, fileScritto), { force: true });
      fileScritto = null;
    }
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('quando Storage risponde non-ok, lo dice nei log e il file va sul fallback locale', async () => {
    const contenuto = Buffer.from('contenuto di prova per il fallback');
    const risultato = await uploadDocumento('test-fallback.pdf', contenuto.toString('base64'));

    // Il ripiego funziona come sempre: URL relativo già firmato e nome d'origine preservato.
    expect(risultato.ok).toBe(true);
    expect(risultato.name).toBe('test-fallback.pdf');
    expect(risultato.url).toMatch(/^\/uploads\/\d+_test-fallback\.pdf\?firma=[0-9a-f]{64}&scad=\d+$/);

    // La parte nuova: il warn onesto, con lo status HTTP e il nome del file.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('507'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('test-fallback.pdf'));

    // Il file è caduto davvero sul disco, con i byte giusti — non basta l'URL perché sia vero.
    // (Il toMatch sopra garantisce la forma dell'URL: la catena opzionale non è mai vuota qui.)
    const nome = risultato.url.split('/uploads/')[1]?.split('?')[0] ?? '';
    fileScritto = nome;
    const percorso = path.join(CARTELLA_UPLOADS, nome);
    expect(fs.existsSync(percorso)).toBe(true);
    expect(fs.readFileSync(percorso).equals(contenuto)).toBe(true);
  });
});
