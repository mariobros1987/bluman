// Adapter Prisma reale per IstanziazionePort — collega la logica di orchestrazione già
// scritta e testata (src/services/istanziaProgetto.ts) a un Postgres vero.
//
// ⚠️ QUESTO FILE NON È MAI STATO COMPILATO NÉ ESEGUITO in questo ambiente di sviluppo:
// `prisma generate` non può scaricare gli engine binari qui (rete bloccata verso
// binaries.prisma.sh), quindi @prisma/client non ha tipi generati e questo file non
// type-checka. È escluso da tsconfig.json apposta (vedi "exclude").
//
// Sulla tua macchina, con rete vera:
//   1. npm install
//   2. npx prisma generate
//   3. npx prisma migrate dev --name init
//   4. npx tsc --noEmit   ← qui questo file DEVE tornare pulito, verificalo esplicitamente
//
// Se non torna pulito, il problema più probabile è un disallineamento tra i nomi dei
// campi usati qui sotto e quelli effettivi in schema.prisma (rinominati durante lo
// sviluppo) — controlla prima lì.

import { conContestoInTransazione, type PrismaConContesto } from '../../util/prismaClient.js';
import type {
  IstanziazionePort,
  IstanziazioneTransazione,
  ModuloTemplateConDistinta,
  StatoMicrovoceIniziale,
  EsecuzionePort,
} from '../../services/istanziazionePort.js';

export class PrismaIstanziazionePort implements IstanziazionePort, EsecuzionePort {
  constructor(
    private readonly prisma: PrismaConContesto,
    private readonly tenantId: string = '00000000-0000-0000-0000-000000000001'
  ) {}

  async eseguiInTransazione<T>(fn: (tx: IstanziazioneTransazione) => Promise<T>): Promise<T> {
    // $transaction di Prisma fornisce già l'atomicità che in fakeIstanziazionePort.ts
    // abbiamo dovuto simulare a mano con lo staging — qui il DB la garantisce nativamente.
    return this.prisma.$transaction(async (tx) => {
      const wrapper: IstanziazioneTransazione = {
        getModuloTemplateConDistinta: async (moduloTemplateId, versione) => {
          const template = await tx.moduloTemplate.findFirstOrThrow({
            where: { id: moduloTemplateId, versione },
            include: {
              righeDistinta: {
                include: { articolo: { include: { passaggiTemplate: true } } },
                orderBy: { ordine: 'asc' },
              },
              dipendenze: true, // ModuloDipendenzaTemplate dove questo modulo è il dipendente
            },
          });

          const righe = template.righeDistinta.map((r) => ({
            id: r.id,
            articoloId: r.articoloId,
            articoloVersione: r.articoloVersione,
            articoloNome: r.articolo.nome,
            quantita: r.quantita,
            ordine: r.ordine,
            oreEffettive: r.overrideOre ?? r.articolo.oreDefault,
            prezzoEffettivo: r.overridePrezzo ?? r.articolo.prezzoDefault,
            passaggi: r.articolo.passaggiTemplate
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

          const result: ModuloTemplateConDistinta = {
            id: template.id,
            versione: template.versione,
            nome: template.nome,
            categoria: template.categoria,
            prezzoPacchetto: template.prezzoPacchetto,
            righe,
            dipendenzeDa: template.dipendenze.map((d) => d.dipendeDaModuloTemplateId),
          };
          return result;
        },

        aggiornaStatoProgetto: async (progettoId, stato) => {
          await tx.progetto.update({ where: { id: progettoId }, data: { stato } });
        },

        creaModuloProgetto: async (input) => {
          const creato = await tx.moduloProgetto.create({
            data: {
              tenantId: this.tenantId,
              progettoId: input.progettoId,
              moduloTemplateId: input.moduloTemplateId,
              moduloTemplateVersione: input.moduloTemplateVersione,
              nome: input.nome,
              categoria: input.categoria,
              prezzo: input.prezzo,
              orePreventivate: input.orePreventivate,
              stato: 'pending',
            },
          });
          return creato.id;
        },

        creaMicrovoceProgetto: async (input) => {
          const creata = await tx.microvoceProgetto.create({
            data: {
              tenantId: this.tenantId,
              moduloProgettoId: input.moduloProgettoId,
              articoloId: input.articoloId,
              articoloVersione: input.articoloVersione,
              rigaDistintaId: input.rigaDistintaId,
              nome: input.nome,
              orePreventivate: input.orePreventivate,
              stato: input.stato,
              ordine: input.ordine,
            },
          });
          return creata.id;
        },

        impostaStatoMicrovoceIniziale: async (microvoceProgettoId, stato: StatoMicrovoceIniziale) => {
          await tx.microvoceProgetto.update({ where: { id: microvoceProgettoId }, data: { stato } });
        },

        creaPassaggioProgetto: async (input) => {
          await tx.passaggioProgetto.create({
            data: {
              tenantId: this.tenantId,
              microvoceProgettoId: input.microvoceProgettoId,
              titolo: input.titolo,
              tipo: input.tipo,
              chi: input.chi,
              ordine: input.ordine,
              descrizione: input.descrizione,
              campiFormJson: input.campiFormJson as never,
              stato: 'pending',
            },
          });
        },

        creaModuloProgettoDipendenza: async (moduloProgettoId, dipendeDaModuloProgettoId) => {
          await tx.moduloProgettoDipendenza.create({
            data: { tenantId: this.tenantId, moduloProgettoId, dipendeDaModuloProgettoId },
          });
        },
      };

      // §14 — la transazione gira su una connessione propria: la variabile di sessione
      // impostata dall'estensione fuori di qui non ci arriva. Va reimpostata sul `tx`,
      // altrimenti le policy RLS non vedono nessun tenant e ogni scrittura viene
      // rifiutata. Segnala anche alle operazioni annidate di non aprire una seconda
      // transazione, che finirebbe su un'altra connessione ancora.
      return conContestoInTransazione(tx, () => fn(wrapper));
    });
  }

  // ── EsecuzionePort — §17: scritture dirette, non transazionali ────────────────────
  // Stesso principio di FakeIstanziazionePort: la transazione multi-entità serve solo
  // per §15.3, non per queste operazioni su singola riga.

  async getMicrovoce(id: string) {
    const mv = await this.prisma.microvoceProgetto.findUniqueOrThrow({ where: { id } });
    return {
      id: mv.id,
      moduloProgettoId: mv.moduloProgettoId,
      stato: mv.stato,
      orePreventivate: mv.orePreventivate,
      oreConsuntivate: mv.oreConsuntivate,
      causaNota: mv.causaNota,
      segnaleRischio: mv.segnaleRischio,
      oreExtra: mv.oreExtra,
    };
  }

  async aggiornaMicrovoce(id: string, updates: Record<string, unknown>) {
    await this.prisma.microvoceProgetto.update({ where: { id }, data: updates });
  }

  async getMicrovociDelModulo(moduloProgettoId: string) {
    const mvs = await this.prisma.microvoceProgetto.findMany({ where: { moduloProgettoId } });
    return mvs.map((mv) => ({
      id: mv.id,
      moduloProgettoId: mv.moduloProgettoId,
      stato: mv.stato,
      orePreventivate: mv.orePreventivate,
      oreConsuntivate: mv.oreConsuntivate,
      causaNota: mv.causaNota,
      segnaleRischio: mv.segnaleRischio,
      oreExtra: mv.oreExtra,
    }));
  }

  async getModulo(id: string) {
    const m = await this.prisma.moduloProgetto.findUniqueOrThrow({ where: { id } });
    return { id: m.id, progettoId: m.progettoId, stato: m.stato };
  }

  async aggiornaModulo(id: string, updates: Record<string, unknown>) {
    await this.prisma.moduloProgetto.update({ where: { id }, data: updates });
  }

  async getModuliDelProgettoConDipendenze(progettoId: string) {
    const moduli = await this.prisma.moduloProgetto.findMany({
      where: { progettoId },
      include: { dipendenze: true }, // ModuloProgettoDipendenza dove questo modulo è il dipendente
    });
    return moduli.map((m) => ({
      id: m.id,
      stato: m.stato,
      dipendeDa: m.dipendenze.map((d) => d.dipendeDaModuloProgettoId),
    }));
  }

  async getPassaggio(id: string) {
    const p = await this.prisma.passaggioProgetto.findUniqueOrThrow({ where: { id } });
    return { id: p.id, microvoceProgettoId: p.microvoceProgettoId, tipo: p.tipo, chi: p.chi, stato: p.stato };
  }

  async getPassaggiDellaMicrovoce(microvoceProgettoId: string) {
    const passaggi = await this.prisma.passaggioProgetto.findMany({ where: { microvoceProgettoId } });
    return passaggi.map((p) => ({ id: p.id, microvoceProgettoId: p.microvoceProgettoId, tipo: p.tipo, chi: p.chi, stato: p.stato }));
  }

  async aggiornaPassaggio(id: string, updates: Record<string, unknown>) {
    await this.prisma.passaggioProgetto.update({ where: { id }, data: updates });
  }
}
