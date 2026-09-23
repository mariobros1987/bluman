/**
 * KYC §5.5.2 — la porta verso i provider di verifica esterni (Registro Imprese / visura e
 * screening PEP-liste sanzionatorie), disaccoppiata come chiede la spec §4.3: la logica di dominio
 * non sa quale fornitore c'è sotto, così cambiarlo non tocca il motore né le rotte.
 *
 * Qui c'è solo l'INTERFACCIA + uno STUB: nessun provider è collegato. Lo stub non inventa dati
 * (regola 7): dichiara «non disponibile / non eseguito», così a valle si distingue «UBO assente»
 * da «UBO non ancora verificato». Quando si sottoscrive un fornitore, si aggiunge un adapter che
 * implementa `ProviderVerificaEsterna` e lo si restituisce da `providerVerificaCorrente()`.
 */

export interface RisultatoUbo {
  disponibile: boolean;
  fonte: 'registro_camerale' | 'autodichiarazione';
  ubo: string | null;
  ragioneSociale?: string | null;
}

export interface RisultatoScreening {
  eseguito: boolean;
  pep: boolean;
  corrispondenzeListe: string[];
}

export interface ProviderVerificaEsterna {
  /** Recupera il titolare effettivo / visura da P.IVA (Registro Imprese). */
  recuperaUboDaPiva(piva: string): Promise<RisultatoUbo>;
  /** Screening PEP e liste sanzionatorie (OFAC/UE/ONU) su un nominativo. */
  screeningPepListe(nominativo: string, paese?: string | null): Promise<RisultatoScreening>;
}

/** Nessun provider collegato: non recupera e non screena nulla, ma NON finge di averlo fatto. */
export class ProviderVerificaStub implements ProviderVerificaEsterna {
  async recuperaUboDaPiva(_piva: string): Promise<RisultatoUbo> {
    return { disponibile: false, fonte: 'autodichiarazione', ubo: null, ragioneSociale: null };
  }
  async screeningPepListe(_nominativo: string, _paese?: string | null): Promise<RisultatoScreening> {
    return { eseguito: false, pep: false, corrispondenzeListe: [] };
  }
}

/** Il provider attivo. Oggi lo stub; domani l'adapter del fornitore scelto dallo studio. */
export function providerVerificaCorrente(): ProviderVerificaEsterna {
  return new ProviderVerificaStub();
}
