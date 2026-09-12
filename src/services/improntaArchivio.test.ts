/**
 * Lettura del file dall'archivio per calcolare l'impronta di ciò che si firma.
 *
 * Il guasto che questi test presidiano: l'impronta SHA-256 scritta nel sigillo arrivava dal
 * body della richiesta, cioè dal browser di chi stava firmando. Chi firma può scrivere
 * l'impronta che vuole, e un sigillo che «identifica il documento firmato» con un valore
 * scelto dal firmatario non identifica niente. Per i documenti del fascicolo il file sta qui,
 * quindi l'impronta si calcola qui — e se il file non è leggibile la firma non si appone,
 * invece di ripiegare su un'impronta presa da fuori.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { leggiFileArchivio, CARTELLA_UPLOADS, urlUploadFirmato } from './storageService';

const NOME = 'test_impronta_archivio.pdf';
const CONTENUTO = Buffer.from('%PDF-1.4 contenuto del documento firmato');
const PERCORSO = path.join(CARTELLA_UPLOADS, NOME);

describe('leggiFileArchivio', () => {
  beforeAll(() => {
    fs.mkdirSync(CARTELLA_UPLOADS, { recursive: true });
    fs.writeFileSync(PERCORSO, CONTENUTO);
  });

  afterAll(() => {
    try {
      fs.unlinkSync(PERCORSO);
    } catch {
      // Il file può già non esserci: non è un fallimento del test.
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('legge il file del ripiego locale a partire dal suo URL firmato', async () => {
    const contenuto = await leggiFileArchivio(urlUploadFirmato(NOME));
    expect(contenuto).not.toBeNull();
    expect(crypto.createHash('sha256').update(contenuto as Buffer).digest('hex')).toBe(
      crypto.createHash('sha256').update(CONTENUTO).digest('hex'),
    );
  });

  it('ignora la stringa di query: la firma dell URL non fa parte del contenuto', async () => {
    const senzaFirma = await leggiFileArchivio(`/uploads/${NOME}`);
    const conFirma = await leggiFileArchivio(urlUploadFirmato(NOME));
    expect(senzaFirma?.equals(conFirma as Buffer)).toBe(true);
  });

  it('rifiuta un nome che tenta di uscire dalla cartella', async () => {
    expect(await leggiFileArchivio('/uploads/../../.env')).toBeNull();
    expect(await leggiFileArchivio('/uploads/..%2F.env')).toBeNull();
  });

  it('ritorna null quando il file non c è, invece di un buffer vuoto', async () => {
    expect(await leggiFileArchivio('/uploads/questo_file_non_esiste_mai.pdf')).toBeNull();
  });

  it('non esegue fetch verso origin esterni o path storage inattesi', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://storage.example.test');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await leggiFileArchivio('https://evil.example.test/storage/v1/object/public/bluman-documents/a.pdf')).toBeNull();
    expect(await leggiFileArchivio('https://storage.example.test.evil.test/storage/v1/object/public/bluman-documents/a.pdf')).toBeNull();
    expect(await leggiFileArchivio('https://storage.example.test/rest/v1/bluman-documents/a.pdf')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('legge solo il bucket documentale sull origin Supabase esatto senza seguire redirect', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://storage.example.test');
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'service-test');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer });
    vi.stubGlobal('fetch', fetchMock);
    const contenuto = await leggiFileArchivio('https://storage.example.test/storage/v1/object/public/bluman-documents/a.pdf');
    expect(Array.from(contenuto ?? [])).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'https://storage.example.test' }),
      expect.objectContaining({ redirect: 'error', headers: { Authorization: 'Bearer service-test', apikey: 'service-test' } }),
    );
  });

  it('rifiuta gli URL che non sono né locali né http', async () => {
    expect(await leggiFileArchivio('')).toBeNull();
    expect(await leggiFileArchivio('   ')).toBeNull();
    expect(await leggiFileArchivio('file:///etc/passwd')).toBeNull();
    expect(await leggiFileArchivio('data:application/pdf;base64,AAAA')).toBeNull();
  });
});
