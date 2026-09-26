/**
 * KYC/AML Fase K9/§5.5 — report riassuntivo del FASCICOLO per le ispezioni. PURO: nessun DB/HTTP.
 *
 * Assembla in una struttura leggibile tutto lo stato di adeguata verifica di un cliente — soggetto,
 * titolari effettivi, rischio a 4 pilastri, screening, anomalie e decisioni MLRO, segnalazioni,
 * conservazione e storico degli stati — da consegnare all'ispettore. La rotta carica i dati (ha le
 * query) e passa qui le righe già lette; qui non si interroga il database.
 */

export interface ReportFascicolo {
  generatoIl: string; // ISO
  studio: { ragioneSociale: string | null; partitaIva: string | null; mlroUserId: string | null };
  fascicolo: {
    stato: string;
    livelloVerifica: string;
    rischioCalcolato: string;
    dataVerifica: string | null;
    dataScadenza: string | null;
    chiusoAt: string | null;
    retentionScadenza: string | null;
    retentionEsito: string | null;
  };
  soggetto: { denominazione: string | null; tipo: string | null; codiceFiscale: string | null; paeseResidenza: string | null; pep: boolean };
  titolariEffettivi: Array<{ denominazione: string | null; criterio: string | null; percentuale: string | null; fonte: string | null }>;
  rischio: { livelloComplessivo: string; cliente: string; geografia: string; prodotto: string; canale: string; motivazione: string | null } | null;
  screening: Array<{ tipo: string; esito: string; dataScreening: string | null; note: string | null }>;
  anomalie: Array<{ tipo: string; descrizione: string; stato: string; decisione: string | null; motivazioneDecisione: string | null }>;
  segnalazioni: Array<{ stato: string; riferimentoGoaml: string | null; trasmessaAt: string | null }>;
  storico: Array<{ statoPrecedente: string | null; statoNuovo: string; motivazione: string | null; data: string | null }>;
}

export interface DatiReportFascicolo {
  studio: { ragioneSociale?: string | null; partitaIva?: string | null; mlroUserId?: string | null };
  fascicolo: {
    stato: string; livelloVerifica: string; rischioCalcolato: string;
    dataVerifica?: Date | string | null; dataScadenza?: Date | string | null;
    chiusoAt?: Date | string | null; retentionScadenza?: Date | string | null; retentionEsito?: string | null;
    paeseResidenza?: string | null; pep?: boolean | null;
  };
  soggetto: { denominazione?: string | null; tipo?: string | null; codiceFiscale?: string | null } | null;
  titolariEffettivi: Array<{ criterio?: string | null; percentuale?: unknown; fonte?: string | null; soggetto?: { denominazione?: string | null } | null }>;
  rischio: { livelloComplessivo?: string | null; clienteLivello?: string | null; geografiaLivello?: string | null; prodottoLivello?: string | null; canaleLivello?: string | null; motivazioneComplessiva?: string | null } | null;
  screening: Array<{ tipo?: string | null; esito?: string | null; dataScreening?: Date | string | null; matchDettagli?: string | null; notaRisoluzione?: string | null }>;
  anomalie: Array<{ tipo: string; descrizione: string; stato: string; decisioni?: Array<{ decisione: string; motivazione: string }> }>;
  segnalazioni: Array<{ stato: string; riferimentoGoaml?: string | null; trasmessaAt?: Date | string | null }>;
  storico: Array<{ statoPrecedente?: string | null; statoNuovo: string; motivazione?: string | null; createdAt?: Date | string | null }>;
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function costruisciReportFascicolo(d: DatiReportFascicolo, generatoIl: string): ReportFascicolo {
  return {
    generatoIl,
    studio: { ragioneSociale: d.studio.ragioneSociale ?? null, partitaIva: d.studio.partitaIva ?? null, mlroUserId: d.studio.mlroUserId ?? null },
    fascicolo: {
      stato: d.fascicolo.stato,
      livelloVerifica: d.fascicolo.livelloVerifica,
      rischioCalcolato: d.fascicolo.rischioCalcolato,
      dataVerifica: iso(d.fascicolo.dataVerifica ?? null),
      dataScadenza: iso(d.fascicolo.dataScadenza ?? null),
      chiusoAt: iso(d.fascicolo.chiusoAt ?? null),
      retentionScadenza: iso(d.fascicolo.retentionScadenza ?? null),
      retentionEsito: d.fascicolo.retentionEsito ?? null,
    },
    soggetto: {
      denominazione: d.soggetto?.denominazione ?? null,
      tipo: d.soggetto?.tipo ?? null,
      codiceFiscale: d.soggetto?.codiceFiscale ?? null,
      paeseResidenza: d.fascicolo.paeseResidenza ?? null,
      pep: d.fascicolo.pep === true,
    },
    titolariEffettivi: d.titolariEffettivi.map((t) => ({
      denominazione: t.soggetto?.denominazione ?? null,
      criterio: t.criterio ?? null,
      percentuale: t.percentuale == null ? null : String(t.percentuale),
      fonte: t.fonte ?? null,
    })),
    rischio: d.rischio
      ? {
          livelloComplessivo: d.rischio.livelloComplessivo ?? 'n/d',
          cliente: d.rischio.clienteLivello ?? 'n/d',
          geografia: d.rischio.geografiaLivello ?? 'n/d',
          prodotto: d.rischio.prodottoLivello ?? 'n/d',
          canale: d.rischio.canaleLivello ?? 'n/d',
          motivazione: d.rischio.motivazioneComplessiva ?? null,
        }
      : null,
    screening: d.screening.map((s) => ({ tipo: s.tipo ?? 'n/d', esito: s.esito ?? 'n/d', dataScreening: iso(s.dataScreening ?? null), note: s.notaRisoluzione ?? s.matchDettagli ?? null })),
    anomalie: d.anomalie.map((a) => ({
      tipo: a.tipo, descrizione: a.descrizione, stato: a.stato,
      decisione: a.decisioni?.[0]?.decisione ?? null,
      motivazioneDecisione: a.decisioni?.[0]?.motivazione ?? null,
    })),
    segnalazioni: d.segnalazioni.map((s) => ({ stato: s.stato, riferimentoGoaml: s.riferimentoGoaml ?? null, trasmessaAt: iso(s.trasmessaAt ?? null) })),
    storico: d.storico.map((s) => ({ statoPrecedente: s.statoPrecedente ?? null, statoNuovo: s.statoNuovo, motivazione: s.motivazione ?? null, data: iso(s.createdAt ?? null) })),
  };
}
