/**
 * KYC/AML Fase K8b (Malta, spec §5.3/§10) — regole PURE della segnalazione FIAU (STR).
 *
 * PURO: nessun DB/HTTP. Il service carica il fascicolo e persiste; qui vivono l'assemblaggio del
 * dossier (snapshot da consegnare all'MLRO), la validazione del riferimento goAML e i predicati di
 * transizione, così la logica è una sola e testabile senza database.
 *
 * Principio (spec §10): in prima fase NESSUNA integrazione diretta con goAML. Il sistema **prepara i
 * dati** e **registra riferimento e timestamp** dopo l'invio manuale dell'MLRO sul portale FIAU. Non
 * si genera qui il tracciato XSD regolatorio: il dossier è un documento leggibile per l'MLRO.
 */

export type StatoSegnalazioneFiau = 'preparata' | 'trasmessa';

/** Snapshot immutabile del fascicolo all'istante della preparazione: è la fonte del dossier PDF. */
export interface DossierStr {
  preparatoIl: string; // ISO
  studio: { ragioneSociale: string | null; partitaIva: string | null; mlroUserId: string | null };
  soggetto: {
    denominazione: string | null;
    tipo: string | null;
    codiceFiscale: string | null;
    paeseResidenza: string | null;
    pep: boolean;
  };
  titolariEffettivi: Array<{ denominazione: string | null; criterio: string | null; percentuale: string | null; fonte: string | null }>;
  rischio: {
    livelloComplessivo: string;
    cliente: string;
    geografia: string;
    prodotto: string;
    canale: string;
    motivazione: string | null;
  } | null;
  screening: Array<{ tipo: string; esito: string; dataScreening: string | null; note: string | null }>;
  anomalia: { tipo: string; descrizione: string; rilevataIl: string | null };
  decisioneMlro: { decisione: string; motivazione: string; decisaIl: string | null } | null;
}

/** Righe già caricate dal service (nessuna query qui): entità di dominio in ingresso, valori in uscita. */
export interface DatiFascicoloPerDossier {
  studio: { ragioneSociale?: string | null; partitaIva?: string | null; mlroUserId?: string | null };
  soggetto: { denominazione?: string | null; tipo?: string | null; codiceFiscale?: string | null } | null;
  fascicolo: { paeseResidenza?: string | null; pep?: boolean | null };
  titolariEffettivi: Array<{ criterio?: string | null; percentuale?: unknown; fonte?: string | null; soggetto?: { denominazione?: string | null } | null }>;
  rischio: {
    livelloComplessivo?: string | null;
    clienteLivello?: string | null;
    geografiaLivello?: string | null;
    prodottoLivello?: string | null;
    canaleLivello?: string | null;
    motivazioneComplessiva?: string | null;
  } | null;
  screening: Array<{ tipo?: string | null; esito?: string | null; dataScreening?: Date | string | null; matchDettagli?: string | null; notaRisoluzione?: string | null }>;
  anomalia: { tipo: string; descrizione: string; createdAt?: Date | string | null };
  decisione: { decisione: string; motivazione: string; createdAt?: Date | string | null } | null;
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Assembla il dossier STR dai dati già caricati. Puro: stesso input → stesso output. */
export function costruisciDossierStr(dati: DatiFascicoloPerDossier, preparatoIl: string): DossierStr {
  return {
    preparatoIl,
    studio: {
      ragioneSociale: dati.studio.ragioneSociale ?? null,
      partitaIva: dati.studio.partitaIva ?? null,
      mlroUserId: dati.studio.mlroUserId ?? null,
    },
    soggetto: {
      denominazione: dati.soggetto?.denominazione ?? null,
      tipo: dati.soggetto?.tipo ?? null,
      codiceFiscale: dati.soggetto?.codiceFiscale ?? null,
      paeseResidenza: dati.fascicolo.paeseResidenza ?? null,
      pep: dati.fascicolo.pep === true,
    },
    titolariEffettivi: dati.titolariEffettivi.map((t) => ({
      denominazione: t.soggetto?.denominazione ?? null,
      criterio: t.criterio ?? null,
      percentuale: t.percentuale == null ? null : String(t.percentuale),
      fonte: t.fonte ?? null,
    })),
    rischio: dati.rischio
      ? {
          livelloComplessivo: dati.rischio.livelloComplessivo ?? 'n/d',
          cliente: dati.rischio.clienteLivello ?? 'n/d',
          geografia: dati.rischio.geografiaLivello ?? 'n/d',
          prodotto: dati.rischio.prodottoLivello ?? 'n/d',
          canale: dati.rischio.canaleLivello ?? 'n/d',
          motivazione: dati.rischio.motivazioneComplessiva ?? null,
        }
      : null,
    screening: dati.screening.map((s) => ({
      tipo: s.tipo ?? 'n/d',
      esito: s.esito ?? 'n/d',
      dataScreening: iso(s.dataScreening ?? null),
      note: s.notaRisoluzione ?? s.matchDettagli ?? null,
    })),
    anomalia: {
      tipo: dati.anomalia.tipo,
      descrizione: dati.anomalia.descrizione,
      rilevataIl: iso(dati.anomalia.createdAt ?? null),
    },
    decisioneMlro: dati.decisione
      ? { decisione: dati.decisione.decisione, motivazione: dati.decisione.motivazione, decisaIl: iso(dati.decisione.createdAt ?? null) }
      : null,
  };
}

/**
 * Il riferimento goAML lo rilascia il portale FIAU dopo l'invio; qui non ne conosciamo il formato
 * esatto (spec §10 «[da verificare]»), quindi si valida solo che sia una stringa non vuota e
 * plausibile — meglio accettare un riferimento reale sconosciuto che rifiutarlo per un pattern indovinato.
 */
export function riferimentoGoamlValido(rif: string): boolean {
  const t = rif.trim();
  return t.length >= 3 && t.length <= 120;
}

/** Solo una segnalazione `preparata` può passare a `trasmessa`; una già trasmessa non si ritrasmette. */
export function puoTrasmettere(stato: StatoSegnalazioneFiau): boolean {
  return stato === 'preparata';
}

const ETICHETTA_STATO: Record<StatoSegnalazioneFiau, string> = {
  preparata: 'preparata (in attesa di invio FIAU)',
  trasmessa: 'trasmessa alla FIAU',
};

/** Frase esplicativa dello stato (regola 12). */
export function etichettaStatoSegnalazione(s: StatoSegnalazioneFiau): string {
  return ETICHETTA_STATO[s];
}
