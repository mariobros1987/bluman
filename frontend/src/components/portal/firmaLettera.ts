/**
 * Se la lettera d'incarico di **questo progetto** è firmata — e il sigillo da mostrare.
 *
 * Era la cosa sbagliata da calcolare. Il portale teneva un booleano `signed` per **cliente**,
 * «questo cliente ha mai firmato una lettera?», e con più incarichi aperti una firma vecchia
 * marcava come firmati anche quelli nati dopo: sul VPS, il 02/10/2026, il progetto «prova
 * server» — creato quel giorno — risultava già firmato da una firma dell'08/09/2026.
 *
 * La domanda giusta non è «ha firmato?» ma «*quale* incarico ha firmato?», e la risposta è nel
 * dato: ogni firma porta il progetto su cui è stata apposta (`riferimentoId`, che il backend
 * ora pretende — vedi `progettoDaIncaricare` in `src/routes/firma.ts`).
 *
 * Una firma **senza** riferimento non firma nessun progetto, e non è una svista: le righe
 * scritte prima del 02/10/2026 non dicevano su cosa fossero state apposte. Trattarle come
 * «firmato» rimetterebbe in piedi il difetto; trattarle come nulle è la verità.
 */
export interface StatoFirmaLettera {
  signed: boolean;
  eidasSeal: any | null;
}

export function statoFirmaLettera(
  firme: any[],
  progettoId: string,
  nomeFallback: string,
): StatoFirmaLettera {
  // Senza progetto selezionato non c'è nessuna lettera da mostrare firmata: `''` è il valore
  // che `ricaricaProgetti` mette quando il cliente non ha progetti, e non deve combaciare con
  // una firma il cui riferimento fosse a sua volta vuoto.
  const firma = progettoId
    ? firme.find((f) => f?.riferimentoId && f.riferimentoId === progettoId)
    : undefined;

  if (!firma) return { signed: false, eidasSeal: null };

  return {
    signed: true,
    // Il sigillo che il portale mostra (repertorio, marca temporale, impronta) è ricostruito
    // dalla stessa riga che vede lo studio. `userAgent` non lo espone `GET /firme`: resta
    // nullo invece di essere inventato (regola 7).
    eidasSeal: {
      id: firma.id,
      signatureId: firma.signatureId,
      tipoFirma: firma.tipoFirma,
      signerName: firma.firmatarioNome || nomeFallback,
      documentoTitolo: firma.documentoTitolo,
      timestampIso: firma.firmatoAt,
      documentoHash: firma.documentoHash,
      sha256Digest: firma.fileFirmatoHash ?? firma.documentoHash,
      ipAddress: firma.ipAddress ?? null,
      userAgent: null,
      canaleVerificato: firma.canaleVerificato,
      standard: firma.standard,
      fileFirmatoUrl: firma.fileFirmatoUrl,
    },
  };
}
