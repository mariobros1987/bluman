// Le cose che il cliente deve fare, messe insieme per la pagina personale.
//
// L'elenco lo calcola il server (`GET /portal/riepilogo`). Qui si aggiungono soltanto i documenti
// da firmare, con il segnale `richiedeFirma` che il server dà in `GET /portal/documenti`: è
// l'unico punto in cui si decide se un documento va firmato, e non si rifà quella regola altrove.
import type { DocumentoPortale } from '../../api/client';
import type { AzioneCliente, RiepilogoProgetto } from '../../api/canaleProtetto';

export interface AzioneDelProgetto extends AzioneCliente {
  progettoId: string;
  progettoNome: string;
}

export function azioniDelProgetto(progetto: RiepilogoProgetto, documenti: DocumentoPortale[]): AzioneDelProgetto[] {
  const daFirmare: AzioneCliente[] = documenti
    .filter((d) => d.richiedeFirma && d.progettoId === progetto.id)
    .map((d) => ({
      tipo: 'firma_documento',
      titolo: `Firma «${d.titolo}»`,
      dettaglio: 'Lo studio ha pubblicato questo documento nel tuo fascicolo: leggilo e firmalo.',
      scheda: 'documenti',
      riferimentoId: d.id,
      urgente: false,
    }));
  // Le urgenti restano in testa; i documenti da firmare vengono subito dopo.
  const urgenti = progetto.azioni.filter((a) => a.urgente);
  const altre = progetto.azioni.filter((a) => !a.urgente);
  return [...urgenti, ...daFirmare, ...altre].map((a) => ({ ...a, progettoId: progetto.id, progettoNome: progetto.nome }));
}

/** Chi deve muoversi adesso su un incarico, contando anche i documenti da firmare. */
export function turnoDelProgetto(progetto: RiepilogoProgetto, azioni: AzioneCliente[]): 'cliente' | 'studio' | 'concluso' {
  if (azioni.length > 0) return 'cliente';
  return progetto.turno === 'concluso' ? 'concluso' : 'studio';
}
