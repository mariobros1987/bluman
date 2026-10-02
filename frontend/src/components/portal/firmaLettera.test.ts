import { describe, it, expect } from 'vitest';
import { statoFirmaLettera } from './firmaLettera';

/**
 * Il difetto che questi test tengono fermo, trovato sul VPS il 02/10/2026:
 *
 * il progetto «prova server», creato quel giorno, risultava **già firmato**. Non lo era: il
 * portale chiedeva «questo cliente ha mai firmato una lettera d'incarico?» e trovava una firma
 * dell'08/09/2026. La domanda era sbagliata — la lettera si firma su un incarico, e con più
 * progetti aperti una firma vecchia ne marcava come firmati anche quelli nati dopo.
 */

/** Una firma come la restituisce `GET /firme`: `riferimentoId` è il progetto su cui è apposta. */
function firma(riferimentoId: string | null, extra: Record<string, unknown> = {}) {
  return {
    id: 'firma-1',
    signatureId: 'SIGILLO-SES-abc',
    tipoFirma: 'fea_otp',
    riferimentoId,
    firmatarioNome: 'Mario Rossi',
    documentoTitolo: 'Engagement Letter & Mandato Professionale',
    firmatoAt: '2026-09-08T20:29:54.000Z',
    documentoHash: 'ab'.repeat(32),
    fileFirmatoHash: null,
    ipAddress: '1.2.3.4',
    canaleVerificato: 'email',
    standard: 'eIDAS',
    fileFirmatoUrl: null,
    ...extra,
  };
}

describe("📄 statoFirmaLettera — la lettera firmata è quella del progetto, non del cliente", () => {
  it('un progetto nato dopo la firma NON risulta firmato', () => {
    // È il caso «prova server»: la firma è del cliente, ma è di un altro incarico.
    const stato = statoFirmaLettera([firma('progetto-vecchio')], 'prova-server', 'Mario Rossi');
    expect(stato.signed).toBe(false);
    expect(stato.eidasSeal).toBeNull();
  });

  it('il progetto su cui la firma è stata apposta risulta firmato', () => {
    const stato = statoFirmaLettera([firma('prova-server')], 'prova-server', 'Mario Rossi');
    expect(stato.signed).toBe(true);
    expect(stato.eidasSeal.signatureId).toBe('SIGILLO-SES-abc');
    // La marca temporale mostrata è quella della firma, non «adesso».
    expect(stato.eidasSeal.timestampIso).toBe('2026-09-08T20:29:54.000Z');
    expect(stato.eidasSeal.sha256Digest).toBe('ab'.repeat(32));
  });

  it('una firma senza riferimento non firma nessun progetto', () => {
    // Le righe scritte prima del 02/10/2026 sono così: la firma non dice su cosa è stata
    // apposta. Trattarle come «firmato» rimetterebbe in piedi il difetto; non marcano niente.
    const stato = statoFirmaLettera([firma(null)], 'qualsiasi-progetto', 'Mario Rossi');
    expect(stato.signed).toBe(false);
  });

  it('senza progetto selezionato non c\'è niente di firmato da mostrare', () => {
    const stato = statoFirmaLettera([firma('progetto-1')], '', 'Mario Rossi');
    expect(stato.signed).toBe(false);
    expect(stato.eidasSeal).toBeNull();
  });

  it('sceglie la firma del progetto giusto fra tante', () => {
    const stato = statoFirmaLettera(
      [firma('progetto-vecchio'), firma('progetto-1', { signatureId: 'SIGILLO-2' }), firma(null)],
      'progetto-1',
      'Mario Rossi',
    );
    expect(stato.eidasSeal.signatureId).toBe('SIGILLO-2');
  });

  it('senza firme l\'elenco non è firmato, e non è un errore', () => {
    expect(statoFirmaLettera([], 'progetto-1', 'Mario Rossi').signed).toBe(false);
  });

  it('il firmatario di ripiego è il nome del cliente, quando la firma non ne porta uno', () => {
    const stato = statoFirmaLettera([firma('p', { firmatarioNome: '' })], 'p', 'Rossi Costruzioni SRL');
    expect(stato.eidasSeal.signerName).toBe('Rossi Costruzioni SRL');
  });
});
