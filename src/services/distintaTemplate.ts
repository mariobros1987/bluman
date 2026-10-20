// La distinta di un modulo di libreria, tradotta in ciò che il progetto deve contenere.
//
// Queste due funzioni erano scritte dentro l'istanziazione (§15.3) e lì sono rimaste finché
// mancava un secondo lettore. Il secondo lettore è il ripristino delle voci di un modulo vuoto
// (POST /progetti/:id/moduli/:moduloId/ripristina-microvoci): un modulo può essere nato quando
// il suo template non aveva ancora articoli in distinta, e senza questo ripristino restava
// vuoto per sempre. Se ognuno avesse la propria copia delle regole — una micro-voce per nome,
// una per unità di quantità, i passaggi copiati dall'articolo — le due copie prima o poi
// direbbero cose diverse sullo stesso modulo. Quindi: una sola.

import type {
  PassaggioTemplateInput,
  RigaDistintaConArticolo,
} from './istanziazionePort.js';

/**
 * La forma minimale di una riga di `riga_distinta` con l'articolo e i suoi passaggi, come la
 * restituisce Prisma. Strutturale apposta: il chiamante può avere un `include` più largo.
 */
export interface RigaDistintaGrezza {
  id: string;
  articoloId: string;
  articoloVersione: number;
  quantita: number;
  ordine: number;
  overrideOre: number | null;
  overridePrezzo: number | null;
  articolo: {
    nome: string;
    oreDefault: number;
    prezzoDefault: number;
    passaggiTemplate: Array<{
      titolo: string;
      tipo: PassaggioTemplateInput['tipo'];
      chi: PassaggioTemplateInput['chi'];
      ordine: number;
      descrizione: string | null;
      campiFormJson: unknown | null;
    }>;
  };
}

/**
 * Applica gli override della riga sui default dell'articolo e ordina i passaggi. Gli override
 * sono `??` e non `||`: lo zero è un valore scelto («ore incluse: 0»), non un'assenza.
 */
export function risolviRigheDistinta(righe: readonly RigaDistintaGrezza[]): RigaDistintaConArticolo[] {
  return righe.map((r) => ({
    id: r.id,
    articoloId: r.articoloId,
    articoloVersione: r.articoloVersione,
    articoloNome: r.articolo.nome,
    quantita: r.quantita,
    ordine: r.ordine,
    oreEffettive: r.overrideOre ?? r.articolo.oreDefault,
    prezzoEffettivo: r.overridePrezzo ?? r.articolo.prezzoDefault,
    passaggi: [...r.articolo.passaggiTemplate]
      .sort((a, b) => a.ordine - b.ordine)
      .map((p) => ({
        titolo: p.titolo,
        tipo: p.tipo,
        chi: p.chi,
        ordine: p.ordine,
        descrizione: p.descrizione,
        campiFormJson: p.campiFormJson,
      })),
  }));
}

export interface MicrovoceDaCreare {
  articoloId: string;
  articoloVersione: number;
  rigaDistintaId: string;
  nome: string;
  orePreventivate: number;
  ordine: number;
  passaggi: PassaggioTemplateInput[];
}

/**
 * Le micro-voci che una distinta genera: una per NOME (regola titolare), moltiplicata per la
 * quantità della riga.
 *
 * Due righe con lo stesso `articoloNome` — il caso tipico di un template popolato da due seed
 * diversi, stesso articolo sotto id diversi — non devono generare due micro-voci gemelle: si
 * tiene la prima e si saltano le successive. La quantità > 1 sulla STESSA riga resta legittima:
 * sono unità dello stesso articolo, non un duplicato di nome.
 *
 * `nomiGiaPresenti` serve al ripristino: le voci che il modulo ha già non si ricreano.
 */
export function microvociDaDistinta(
  righe: readonly RigaDistintaConArticolo[],
  nomiGiaPresenti: ReadonlySet<string> = new Set(),
): MicrovoceDaCreare[] {
  const nomiVisti = new Set(nomiGiaPresenti);
  const microvoci: MicrovoceDaCreare[] = [];

  for (const riga of righe) {
    const chiaveNome = riga.articoloNome.trim().toLowerCase();
    if (nomiVisti.has(chiaveNome)) continue;
    nomiVisti.add(chiaveNome);

    for (let unita = 0; unita < riga.quantita; unita++) {
      microvoci.push({
        articoloId: riga.articoloId,
        articoloVersione: riga.articoloVersione,
        rigaDistintaId: riga.id,
        nome: riga.articoloNome,
        orePreventivate: riga.oreEffettive,
        ordine: riga.ordine,
        passaggi: riga.passaggi,
      });
    }
  }

  return microvoci;
}
