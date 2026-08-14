// Dati di seed per il quick start — stessi moduli/articoli usati nel prototipo HTML,
// ridotti all'essenziale. Per la versione con Postgres reale, questi diventano righe
// inserite da `npx prisma db seed` (vedi seed.ts).

import type { ModuloTemplateConDistinta } from '../services/istanziazionePort.js';

export const moduloAnalisiPatrimoniale: ModuloTemplateConDistinta = {
  id: 'M01',
  versione: 1,
  nome: 'Analisi patrimoniale iniziale',
  categoria: 'Analisi',
  prezzoPacchetto: null,
  dipendenzeDa: [],
  righe: [
    {
      id: 'RD01',
      articoloId: 'A_RACCOLTA_DOC',
      articoloVersione: 1,
      articoloNome: 'Raccolta documentazione cliente',
      quantita: 1,
      ordine: 1,
      oreEffettive: 2,
      prezzoEffettivo: 600,
      passaggi: [
        { titolo: 'Carica documento identità', tipo: 'documento', chi: 'cliente', ordine: 1, descrizione: 'Copia del passaporto o carta d\'identità in corso di validità.', campiFormJson: null },
      ],
    },
    {
      id: 'RD02',
      articoloId: 'A_ANALISI_STRUTT',
      articoloVersione: 1,
      articoloNome: 'Analisi struttura patrimoniale esistente',
      quantita: 1,
      ordine: 2,
      oreEffettive: 4,
      prezzoEffettivo: 1200,
      passaggi: [],
    },
    {
      id: 'RD03',
      articoloId: 'A_REPORT_ANALISI',
      articoloVersione: 1,
      articoloNome: 'Report analisi iniziale',
      quantita: 1,
      ordine: 3,
      oreEffettive: 3,
      prezzoEffettivo: 900,
      passaggi: [],
    },
  ],
};

export const moduloCorporateStructuring: ModuloTemplateConDistinta = {
  id: 'M02',
  versione: 1,
  nome: 'Corporate structuring Malta',
  categoria: 'Societario',
  prezzoPacchetto: 11500, // dimostra l'override rispetto alla somma righe (§3bis/§7)
  dipendenzeDa: ['M01'], // dimostra il grafo di dipendenze (§7ter)
  righe: [
    {
      id: 'RD04',
      articoloId: 'A_STUDIO_STRUTT',
      articoloVersione: 1,
      articoloNome: 'Studio struttura societaria ottimale',
      quantita: 1,
      ordine: 1,
      oreEffettive: 6,
      prezzoEffettivo: 1800,
      passaggi: [],
    },
    {
      id: 'RD05',
      articoloId: 'A_COST_SOCIETA',
      articoloVersione: 1,
      articoloNome: 'Costituzione società',
      quantita: 1,
      ordine: 2,
      oreEffettive: 10,
      prezzoEffettivo: 3000,
      passaggi: [
        { titolo: 'Firma atto costitutivo', tipo: 'documento', chi: 'cliente', ordine: 1, descrizione: null, campiFormJson: null },
      ],
    },
  ],
};
