import type { DocumentoPortale } from '../../api/client';
import type { CategoriaModulo } from '../../types';
import type { ModuloDeliverable, ModuloPassaggio, ModuloProposta } from './types';

/**
 * Nome file leggibile per il cliente: toglie il prefisso timestamp dell'archivio
 * (`1699999999999_...`) e accorcia un eventuale UUID nudo, che a video è illeggibile
 * («tanti numeri e codici»). Un nome normale (es. «Contratto Malta.pdf») resta intatto.
 */
function nomeFileLeggibile(nome?: string | null, fileUrl?: string | null): string {
  const base =
    (nome && nome.trim()) ||
    (fileUrl ? decodeURIComponent((fileUrl.split('?')[0].split('/').pop() || '')) : '');
  let pulito = base.replace(/^\d{10,}_/, ''); // prefisso timestamp dell'upload
  // UUID nudo (con o senza estensione) → etichetta breve leggibile
  pulito = pulito.replace(/^([0-9a-f]{8})[0-9a-f-]{20,}(\.[a-z0-9]+)?$/i, 'Documento $1$2');
  return pulito.trim() || 'Documento';
}

/**
 * Traduce i moduli REALI del progetto nella forma che il Portale Cliente mostra,
 * associando ad ogni modulo e ad ogni micro-voce i documenti pubblicati a DB.
 */
export function mapProjectToPortalModules(project: any, portalDocs: DocumentoPortale[] = []): ModuloProposta[] {
  if (!project) return [];

  const moduli = Array.isArray(project.moduli) ? project.moduli : [];
  if (moduli.length === 0) return [];

  // Avanzamento calcolato dal backend, indicizzato per id modulo
  const avanzamentoModuli = new Map<string, any>(
    (project.avanzamento?.moduli || []).map((m: any) => [String(m.id), m]),
  );

  return moduli.map((m: any): ModuloProposta => {
    const cat = (m.categoria as CategoriaModulo) || 'Societario';
    const av = avanzamentoModuli.get(String(m.id));
    const statoModulo = av?.stato ?? m.stato;
    const isDone = statoModulo === 'done' || statoModulo === 'completed' || statoModulo === 'completato';

    // Micro-voci reali dal database
    const microvoci = Array.isArray(m.microvoci) ? m.microvoci : [];
    const passaggi: ModuloPassaggio[] = microvoci.map((mv: any, mvIdx: number) => {
      const mvId = mv.id || `mv-${mvIdx}`;
      const docsDiQuestaMicrovoce = portalDocs.filter(d =>
        (d.microvoceProgettoId && String(d.microvoceProgettoId) === String(mv.id)) ||
        (d.microvoceNome && d.microvoceNome.trim().toLowerCase() === (mv.nome || '').trim().toLowerCase() && d.modulo === m.nome)
      );

      return {
        id: mvId,
        titolo: mv.nome,
        completato: mv.stato === 'done' || mv.stato === 'completed',
        note: mv.causaNota || undefined,
        operatore: mv.risorsa?.nome || undefined,
        documenti: docsDiQuestaMicrovoce,
      };
    });

    // Documenti pubblicati dallo studio per questo modulo
    const docsDiQuestoModulo = portalDocs.filter(d =>
      (d.moduloProgettoId && String(d.moduloProgettoId) === String(m.id)) ||
      (d.modulo && d.modulo.trim().toLowerCase() === (m.nome || '').trim().toLowerCase()) ||
      microvoci.some((mv: any) => String(mv.id) === String(d.microvoceProgettoId))
    );

    const deliverables: ModuloDeliverable[] = docsDiQuestoModulo.map(d => ({
      id: d.id,
      titolo: d.titolo || nomeFileLeggibile(d.nome, d.fileUrl),
      nomeFile: nomeFileLeggibile(d.nome, d.fileUrl),
      data: d.caricatoIl ? new Date(d.caricatoIl).toLocaleDateString('it-IT') : new Date().toLocaleDateString('it-IT'),
      fileUrl: d.fileUrl,
      firmato: d.firmato,
      richiedeFirma: d.richiedeFirma,
      docCompleto: d,
    }));

    return {
      id: m.id,
      nome: m.nome,
      cat,
      prezzo: typeof m.prezzo === 'number' && m.prezzo > 0 ? (m.prezzo > 1000 ? m.prezzo / 100 : m.prezzo) : 0,
      ore: m.orePreventivate ?? 0,
      righeCount: passaggi.length,
      descrizione: m.descrizione || undefined,
      stato: isDone ? 'completato' : 'in_corso',
      operatore: microvoci.find((mv: any) => mv.risorsa?.nome)?.risorsa?.nome || undefined,
      percentuale: av?.percentuale ?? 0,
      passaggi,
      deliverables,
      richiedeFirmaFinale: true,
    };
  });
}
