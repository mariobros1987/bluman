import { describe, it, expect } from 'vitest';
import { mimeDaEstensione, nomeFileSicuro, nomeFileValido } from './storageService.js';

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
