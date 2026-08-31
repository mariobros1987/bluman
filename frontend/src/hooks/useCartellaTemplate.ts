// §41 — Il hook della cartella modelli: l'unico posto del frontend che scrive sui modelli.
//
// I gesti sui modelli (crea, modifica, revisiona, archivia, ripristina, elimina, adotta,
// importa) prima erano sparsi fra quattro componenti e finivano metà sul server e metà in
// `localStorage`. Qui stanno insieme, ognuno con la stessa regola: **prima il server, poi
// l'elenco**. Se la chiamata non riesce, l'elenco resta com'era e il messaggio dice cosa è
// andato storto — non «salvato».
//
// `utils/documentTemplates.ts` tiene la copia di lavoro e la fusione con i modelli di serie;
// qui ci sono solo le chiamate di rete e il verdetto da mostrare.

import { useCallback, useEffect, useState } from 'react';
import {
  fetchDocumentiTemplateApi,
  creaDocumentoTemplateApi,
  aggiornaDocumentoTemplateApi,
  eliminaDocumentoTemplateApi,
  revisionaModelloApi,
  archiviaModelloApi,
  adottaModelloSerieApi,
  type ModelloStudioApi,
  type StatoRevisioneModello,
} from '../api/client';
import {
  getAllTemplates,
  impostaModelliStudio,
  segnalaLetturaModelliFallita,
  registraModelloStudio,
  dimenticaModelloStudio,
  statoCartellaModelli,
  modelliSoloLocali,
  scartaResiduoLocale,
  leggiModelliDaJson,
  type DocumentTemplate,
} from '../utils/documentTemplates';

/** Dalla riga del server al modello che l'interfaccia già sa disegnare. */
function daApi(riga: ModelloStudioApi): DocumentTemplate {
  return {
    id: riga.id,
    titolo: riga.titolo,
    categoria: (riga.categoria as DocumentTemplate['categoria']) || 'societario',
    descrizione: riga.descrizione || '',
    contenutoHtml: riga.contenutoHtml || '',
    livelloFirmaRichiesto: riga.livelloFirmaRichiesto || 'ses',
    archiviato: Boolean(riga.archiviatoAt),
    dataCreazione: riga.createdAt,
    statoRevisione: riga.statoRevisione,
    versione: riga.versione,
    noteRevisione: riga.noteRevisione,
    revisionatoDaNome: riga.revisionatoDaNome,
    revisionatoAt: riga.revisionatoAt,
    riferimentoSerie: riga.riferimentoSerie,
    diSerie: false,
  };
}

export interface EsitoGesto {
  ok: boolean;
  messaggio: string;
  /** Il modello come è tornato dal server, quando l'operazione lo restituisce. */
  modello?: DocumentTemplate;
  /**
   * I modelli effettivamente arrivati a database, per le operazioni che ne toccano più di uno
   * (importazione, recupero dei residui locali). Contiene solo quelli confermati dal server:
   * chi li allaccia a un articolo allaccia identificativi che esistono davvero.
   */
  modelli?: DocumentTemplate[];
}

export function useCartellaTemplate() {
  const [modelli, setModelli] = useState<DocumentTemplate[]>(() => getAllTemplates(true));
  const [caricamento, setCaricamento] = useState(false);
  const [erroreLettura, setErroreLettura] = useState<string | null>(statoCartellaModelli().errore);
  const [letto, setLetto] = useState(statoCartellaModelli().stato === 'ok');

  /** Rilegge i modelli dello studio. Gli archiviati arrivano sempre: è la cartella a filtrarli. */
  const sincronizza = useCallback(async (): Promise<EsitoGesto> => {
    setCaricamento(true);
    try {
      const righe = await fetchDocumentiTemplateApi(true);
      impostaModelliStudio(righe.map(daApi));
      setModelli(getAllTemplates(true));
      setErroreLettura(null);
      setLetto(true);
      return { ok: true, messaggio: `${righe.length} modelli dello studio letti dall'archivio.` };
    } catch (err: any) {
      const messaggio = err?.message || 'errore di rete';
      segnalaLetturaModelliFallita(messaggio);
      // Non si azzera l'elenco: quello che si è già letto resta a schermo. Ma `erroreLettura`
      // è valorizzato, così l'interfaccia non fa passare i soli modelli di serie per
      // «la libreria dello studio».
      setModelli(getAllTemplates(true));
      setErroreLettura(messaggio);
      return { ok: false, messaggio: `Non è stato possibile leggere i modelli dello studio: ${messaggio}` };
    } finally {
      setCaricamento(false);
    }
  }, []);

  useEffect(() => {
    void sincronizza();
  }, [sincronizza]);

  const crea = useCallback(
    async (dati: {
      titolo: string;
      categoria?: string;
      descrizione?: string;
      contenutoHtml: string;
      livelloFirmaRichiesto?: 'ses' | 'fea' | 'feq';
    }): Promise<EsitoGesto> => {
      try {
        const riga = await creaDocumentoTemplateApi(dati);
        const modello = daApi(riga);
        setModelli(registraModelloStudio(modello));
        return { ok: true, messaggio: `Modello «${modello.titolo}» salvato nell'archivio dello studio.`, modello };
      } catch (err: any) {
        return { ok: false, messaggio: `Modello «${dati.titolo}» NON salvato: ${err?.message || 'errore di rete'}` };
      }
    },
    [],
  );

  const aggiorna = useCallback(
    async (
      id: string,
      dati: { titolo?: string; categoria?: string; descrizione?: string; contenutoHtml?: string; livelloFirmaRichiesto?: 'ses' | 'fea' | 'feq' },
    ): Promise<EsitoGesto> => {
      try {
        const riga = await aggiornaDocumentoTemplateApi(id, dati);
        const modello = daApi(riga);
        setModelli(registraModelloStudio(modello));
        // La decadenza dell'approvazione è un effetto che l'operatore non ha chiesto: va detto,
        // altrimenti scopre da solo che il modello approvato è tornato in bozza.
        const messaggio = riga.approvazioneDecaduta
          ? `Modello «${modello.titolo}» salvato. Attenzione: il testo era approvato, l'approvazione è decaduta e il modello torna in bozza (versione ${modello.versione}).`
          : `Modello «${modello.titolo}» aggiornato nell'archivio dello studio.`;
        return { ok: true, messaggio, modello };
      } catch (err: any) {
        return { ok: false, messaggio: `Modifica NON salvata: ${err?.message || 'errore di rete'}` };
      }
    },
    [],
  );

  const revisiona = useCallback(
    async (id: string, stato: StatoRevisioneModello, note?: string): Promise<EsitoGesto> => {
      try {
        const riga = await revisionaModelloApi(id, stato, note);
        const modello = daApi(riga);
        setModelli(registraModelloStudio(modello));
        const etichetta = stato === 'approvato' ? 'approvato' : stato === 'in_revisione' ? 'messo in revisione' : 'riportato in bozza';
        return { ok: true, messaggio: `Modello «${modello.titolo}» ${etichetta}.`, modello };
      } catch (err: any) {
        return { ok: false, messaggio: `Stato di revisione NON cambiato: ${err?.message || 'errore di rete'}` };
      }
    },
    [],
  );

  /**
   * Adotta un modello di serie: gli dà una riga a database in questo studio.
   *
   * Serve prima di qualunque altro gesto su una carta di serie — archiviarla, revisionarla o
   * modificarla presuppone che esista una riga a cui appendere quella decisione.
   */
  const adotta = useCallback(async (tmpl: DocumentTemplate): Promise<EsitoGesto> => {
    try {
      const riga = await adottaModelloSerieApi({
        riferimentoSerie: tmpl.riferimentoSerie || tmpl.id,
        titolo: tmpl.titolo,
        categoria: tmpl.categoria,
        descrizione: tmpl.descrizione,
        contenutoHtml: tmpl.contenutoHtml,
        livelloFirmaRichiesto: tmpl.livelloFirmaRichiesto ?? 'ses',
      });
      const modello = daApi(riga);
      setModelli(registraModelloStudio(modello));
      return {
        ok: true,
        modello,
        messaggio: riga.giaAdottato
          ? `Il modello «${modello.titolo}» era già nell'archivio dello studio.`
          : `Modello «${modello.titolo}» adottato: da ora è una carta dello studio e può essere revisionata.`,
      };
    } catch (err: any) {
      return { ok: false, messaggio: `Adozione NON riuscita: ${err?.message || 'errore di rete'}` };
    }
  }, []);

  /**
   * Archivia o ripristina. Su un modello di serie non ancora adottato l'adozione avviene
   * prima e in automatico: «togli questa carta dai miei elenchi» è una decisione dello studio,
   * e una decisione ha bisogno di una riga su cui stare.
   */
  const archivia = useCallback(
    async (tmpl: DocumentTemplate, archiviato: boolean): Promise<EsitoGesto> => {
      let id = tmpl.id;
      if (tmpl.diSerie) {
        const esitoAdozione = await adotta(tmpl);
        if (!esitoAdozione.ok || !esitoAdozione.modello) return esitoAdozione;
        id = esitoAdozione.modello.id;
      }
      try {
        const riga = await archiviaModelloApi(id, archiviato);
        const modello = daApi(riga);
        setModelli(registraModelloStudio(modello));
        return {
          ok: true,
          modello,
          messaggio: archiviato
            ? `Modello «${modello.titolo}» archiviato: esce dagli elenchi operativi di tutto lo studio e resta conservato.`
            : `Modello «${modello.titolo}» ripristinato tra i modelli attivi.`,
        };
      } catch (err: any) {
        return {
          ok: false,
          messaggio: `${archiviato ? 'Archiviazione' : 'Ripristino'} NON riuscito: ${err?.message || 'errore di rete'}`,
        };
      }
    },
    [adotta],
  );

  const elimina = useCallback(async (tmpl: DocumentTemplate): Promise<EsitoGesto> => {
    if (tmpl.diSerie) {
      // Una carta di serie sta nel codice: non c'è nessuna riga da eliminare, e al ricaricamento
      // ricomparirebbe. Per non vederla si archivia — che è quello che l'operatore vuole.
      return {
        ok: false,
        messaggio: `«${tmpl.titolo}» è un modello di serie: non si elimina, si archivia (resta disponibile se serve).`,
      };
    }
    try {
      await eliminaDocumentoTemplateApi(tmpl.id);
      setModelli(dimenticaModelloStudio(tmpl.id));
      return { ok: true, messaggio: `Modello «${tmpl.titolo}» eliminato. I documenti già generati nei progetti restano invariati.` };
    } catch (err: any) {
      return { ok: false, messaggio: `Eliminazione NON riuscita: ${err?.message || 'errore di rete'}. Il modello NON è stato rimosso.` };
    }
  }, []);

  /** Importa un bundle JSON portando ogni modello a database, uno per uno. */
  const importaDaJson = useCallback(async (jsonString: string): Promise<EsitoGesto> => {
    const lettura = leggiModelliDaJson(jsonString);
    if (!lettura.ok) return { ok: false, messaggio: `Importazione non eseguita: ${lettura.errore}` };

    let salvati = 0;
    const creati: DocumentTemplate[] = [];
    const falliti: string[] = [];
    for (const tmpl of lettura.modelli) {
      const esito = await crea({
        titolo: tmpl.titolo,
        categoria: tmpl.categoria,
        descrizione: tmpl.descrizione,
        contenutoHtml: tmpl.contenutoHtml,
        livelloFirmaRichiesto: tmpl.livelloFirmaRichiesto ?? 'ses',
      });
      if (esito.ok && esito.modello) {
        salvati++;
        creati.push(esito.modello);
      } else falliti.push(tmpl.titolo);
    }
    // Il conteggio dice quanti sono ARRIVATI, non quanti erano nel file: era il difetto della
    // versione precedente, che annunciava «N importati» qualunque cosa fosse successo.
    if (falliti.length === 0) {
      return { ok: true, messaggio: `${salvati} modelli importati nell'archivio dello studio.`, modelli: creati };
    }
    return {
      ok: salvati > 0,
      messaggio: `${salvati} modelli importati; ${falliti.length} NON salvati (${falliti.join(', ')}).`,
      modelli: creati,
    };
  }, [crea]);

  /**
   * §41 — Porta a database i modelli rimasti in questo browser.
   *
   * Sono quelli creati prima di §41 dall'importazione JSON, che non passava dal server. Non si
   * cancella niente in anticipo: il residuo locale si scarta solo dopo la conferma della riga.
   */
  const recuperaModelliLocali = useCallback(async (): Promise<EsitoGesto> => {
    const residui = modelliSoloLocali();
    if (residui.length === 0) return { ok: true, messaggio: 'Non ci sono modelli rimasti in questo browser.' };

    let recuperati = 0;
    const falliti: string[] = [];
    for (const tmpl of residui) {
      const esito = await crea({
        titolo: tmpl.titolo,
        categoria: tmpl.categoria,
        descrizione: tmpl.descrizione,
        contenutoHtml: tmpl.contenutoHtml,
        livelloFirmaRichiesto: tmpl.livelloFirmaRichiesto ?? 'ses',
      });
      if (esito.ok) {
        scartaResiduoLocale(tmpl.titolo);
        recuperati++;
      } else {
        falliti.push(tmpl.titolo);
      }
    }
    setModelli(getAllTemplates(true));
    if (falliti.length === 0) return { ok: true, messaggio: `${recuperati} modelli portati nell'archivio dello studio.` };
    return {
      ok: recuperati > 0,
      messaggio: `${recuperati} modelli portati nell'archivio; ${falliti.length} NON salvati (${falliti.join(', ')}): restano in questo browser.`,
    };
  }, [crea]);

  return {
    modelli,
    caricamento,
    /** Valorizzato se la lettura dal server non è riuscita: l'elenco potrebbe essere incompleto. */
    erroreLettura,
    /** Vero solo dopo una lettura riuscita: prima non si sa cosa abbia lo studio. */
    letto,
    sincronizza,
    crea,
    aggiorna,
    revisiona,
    adotta,
    archivia,
    elimina,
    importaDaJson,
    recuperaModelliLocali,
  };
}
