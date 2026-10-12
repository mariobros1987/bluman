import { getTenantStorageKey } from '../../utils/tenant';

// §2.9 — converte una riga della tabella `documento` (API GET /documenti) nella forma
// usata dalla griglia del vault (nome/cat/formato/url).
export function documentoApiAVista(d: any, projectId: string): any {
  // Il prefisso `${Date.now()}_` aggiunto dall'archivio per evitare omonimie non va mostrato.
  const nome = decodeURIComponent((d.fileUrl || '').split('?')[0].split('/').pop() || 'Documento').replace(/^\d{13}_/, '');
  const dataFmt = d.createdAt ? new Date(d.createdAt).toLocaleDateString('it-IT') : '';
  return {
    id: d.id,
    dbDoc: true,
    nome,
    titolo: nome.replace(/\.[^/.]+$/, ''),
    cat: d.categoriaDoc && d.categoriaDoc !== 'generico' ? d.categoriaDoc : 'Allegati Progetto',
    data: dataFmt,
    dataCaricamento: dataFmt,
    progettoId: projectId,
    firmato: Boolean(d.firmato),
    formato: /\.png$|\.jpe?g$/i.test(nome) ? 'immagine' : 'pdf',
    url: d.fileFirmatoUrl || d.filePdfUrl || d.fileUrl,
    filePdfUrl: d.fileFirmatoUrl || d.filePdfUrl || null,
    fileDocxUrl: d.fileDocxUrl ?? null,
    fileBozzaUrl: d.fileBozzaUrl ?? d.fileUrl ?? null,
    // Fix firma — il tipo e i dati del sigillo reale, così la scheda può offrire l'atto
    // sottoscritto e dichiarare lo standard vero senza dedurlo (regola 5).
    tipo: d.tipo,
    fileFirmatoUrl: d.fileFirmatoUrl || d.firma?.fileFirmatoUrl || null,
    firmaStandard: d.firma?.standard ?? null,
    tipoFirma: d.firma?.tipoFirma ?? null,
    dataFirma: d.firma?.firmatoAt ?? null,
  };
}

// Le rimozioni dei documenti che NON stanno su PostgreSQL: le voci del registro locale del Vault
// (i modelli precompilati che il vault fabbricava da solo non esistono più — vedi `DocumentiTab`).
// Senza ricordare le rimozioni, il cestino non ha effetto: la lista si ricostruisce all'apertura
// della scheda e il documento riappare. I documenti veri vivono nella tabella `documento` e li
// cancella l'API: per quelli questo elenco non serve.
export function chiaveDocumentiRimossi(projectId: string | number) {
  return getTenantStorageKey(`bluman_project_documents_removed_${projectId}`);
}

export function documentiRimossi(projectId: string | number): Set<string> {
  try {
    const raw = localStorage.getItem(chiaveDocumentiRimossi(projectId));
    const elenco: unknown = raw ? JSON.parse(raw) : [];
    return new Set<string>(Array.isArray(elenco) ? elenco.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

export function ricordaDocumentoRimosso(projectId: string | number, docId: string) {
  try {
    const elenco = documentiRimossi(projectId);
    elenco.add(docId);
    localStorage.setItem(chiaveDocumentiRimossi(projectId), JSON.stringify([...elenco]));
  } catch {
    // Spazio esaurito o storage negato: la lista in RAM è già aggiornata, ma alla riapertura
    // il modello tornerebbe. Non c'è modo di evitarlo senza una riga sul database.
  }
}
