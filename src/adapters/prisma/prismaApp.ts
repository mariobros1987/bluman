// Implementazione reale di AppPort sopra Postgres — funziona con qualunque Postgres
// raggiungibile via DATABASE_URL, incluso Supabase (è solo Postgres gestito: non serve
// nulla di specifico a Supabase, basta la connection string dalla sua dashboard).
//
// ⚠️ Come gli altri file in questa cartella, mai compilato né eseguito in questo ambiente
// (rete bloccata verso binaries.prisma.sh). Verificalo sulla tua macchina — vedi
// ISTRUZIONI_INSTALLAZIONE.md, Percorso B.

import { conContestoInTransazione, type PrismaConContesto } from '../../util/prismaClient.js';
import { PrismaIstanziazionePort } from './prismaIstanziazionePort.js';
import { istanziaProgetto, calcolaPrezzoModulo } from '../../services/istanziaProgetto.js';
// La notifica di avvio progetto usa il servizio reale (righe Notifica in-app per gli
// operatori attivi dello studio). Prima questo adapter portava uno stub a console.log
// «in attesa del servizio email reale» — che esiste già da §35: emailService/emailRelay.
// Si usa la variante *silenziosa*: l'istanziazione è una transazione riuscita, e una
// notifica che non parte non deve farla sembrare fallita. L'errore resta nel log.
import { notificaStudioSilenziosa } from '../../services/notificheService.js';
import {
  registraConsuntivazione,
  marcaRitardo,
  risolviRitardo,
  completaMicrovoce as completaMicrovoceService,
  completaPassaggioDocumento as completaPassaggioDocumentoService,
  completaPassaggioForm as completaPassaggioFormService,
  marcaPassaggioCompletato as marcaPassaggioCompletatoService,
} from '../../services/esecuzione.js';
import type { AppPort, ModuloElencoItem, Cliente, ProgettoBase, Preventivo } from '../../services/appPort.js';
import type { NotificationPort } from '../../services/istanziazionePort.js';
import {
  ClienteNonTrovatoError,
  ProgettoNonTrovatoError,
  PreventivoNonTrovatoError,
  ModuloNonTrovatoError,
  TransizioneNonValidaError,
  DipendenzaCiclicaError,
} from '../appErrors.js';
import { trovaCicloDipendenze } from '../../services/dipendenzeModuli.js';

/**
 * Notifica di avvio progetto (§10, §22) — righe Notifica in-app per gli operatori
 * attivi dello studio, via `notificaStudioSilenziosa`. Il fallback a console.log resta
 * per quando il database non risponde: la notifica non deve mai rompere l'avvio.
 */
class NotificheStudioPort implements NotificationPort {
  constructor(private readonly tenantId: string) {}

  async notificaProgettoAvviato(input: { progettoId: string; clienteId: string; moduliProgettoIds: string[] }): Promise<void> {
    try {
      const inviate = await notificaStudioSilenziosa(this.tenantId, {
        // 'modulo_completato' qui non c'entra, ma è l'unico evento della matrice che
        // parla di lavoro in corso sul fascicolo: la lista è chiusa per scelta
        // (EVENTI_NOTIFICA, «niente inventario aperto»), e un tipo fuori lista
        // romperebbe la campanella del frontend che filtra proprio su questi valori.
        tipoEvento: 'modulo_completato',
        oggetto: 'Nuovo progetto avviato',
        corpo: `Il progetto è stato istanziato con ${input.moduliProgettoIds.length} moduli per il cliente ${input.clienteId}.`,
        link: `/progetti/${input.progettoId}`,
      });
      if (inviate === 0) {
        console.log('[notifica] Progetto avviato, nessun operatore attivo da notificare:', input.progettoId);
      }
    } catch (err) {
      console.warn('[notifica] Notifica avvio progetto non registrata:', err instanceof Error ? err.message : err);
    }
  }
}

export class PrismaApp implements AppPort {
  private readonly istanziazione: PrismaIstanziazionePort;
  private readonly notifiche: NotificationPort;
  private readonly tenantId: string;

  constructor(private readonly prisma: PrismaConContesto, tenantId: string) {
    this.tenantId = tenantId;
    this.istanziazione = new PrismaIstanziazionePort(prisma, tenantId);
    this.notifiche = new NotificheStudioPort(tenantId);
  }

  async listaModuli(): Promise<any[]> {
    const moduli = await this.prisma.moduloTemplate.findMany({
      where: { tenantId: this.tenantId, isAttivo: true },
      include: {
        righeDistinta: {
          include: { articolo: true },
        },
        dipendenze: true,
      },
    });
    return moduli;
  }

  async listaArticoli() {
    return this.prisma.articolo.findMany({
      where: { tenantId: this.tenantId, isAttivo: true },
      include: { passaggiTemplate: true },
      orderBy: { categoria: 'asc' },
    });
  }

  async creaArticolo(input: {
    nome: string;
    categoria: string;
    oreDefault: number;
    prezzoDefault: number;
    passaggi?: Array<{ titolo: string; tipo: 'info' | 'documento' | 'form' | 'verifica'; chi: 'operatore' | 'cliente'; descrizione?: string }>;
  }) {
    const articolo = await this.prisma.articolo.create({
      data: {
        tenantId: this.tenantId,
        nome: input.nome,
        categoria: input.categoria,
        oreDefault: input.oreDefault,
        prezzoDefault: input.prezzoDefault,
        versione: 1,
      },
    });

    if (input.passaggi && input.passaggi.length > 0) {
      for (const [idx, p] of input.passaggi.entries()) {
        await this.prisma.passaggioTemplate.create({
          data: {
            articoloId: articolo.id,
            titolo: p.titolo,
            tipo: p.tipo,
            chi: p.chi,
            ordine: idx + 1,
            descrizione: p.descrizione || null,
          },
        });
      }
    }

    return this.prisma.articolo.findUnique({
      where: { id: articolo.id },
      include: { passaggiTemplate: true },
    });
  }

  async creaModuloTemplate(input: {
    nome: string;
    categoria: string;
    giurisdizioneId?: string | null;
    prezzoPacchetto?: number | null;
    righe: Array<{ articoloId: string; quantita: number; overrideOre?: number; overridePrezzo?: number }>;
    dipendenzeDaIds?: string[];
  }) {
    const modulo = await this.prisma.moduloTemplate.create({
      data: {
        tenantId: this.tenantId,
        nome: input.nome,
        categoria: input.categoria,
        // Prima il campo non veniva raccolto dal body e finiva sempre null: il filtro
        // per giurisdizione della libreria mostrava ogni modulo come «generico».
        giurisdizioneId: input.giurisdizioneId || null,
        prezzoPacchetto: input.prezzoPacchetto || null,
        versione: 1,
      },
    });

    for (const [idx, r] of input.righe.entries()) {
      const art = await this.prisma.articolo.findUniqueOrThrow({ where: { id: r.articoloId } });
      await this.prisma.rigaDistinta.create({
        data: {
          tenantId: this.tenantId,
          moduloTemplateId: modulo.id,
          articoloId: r.articoloId,
          articoloVersione: art.versione,
          ordine: idx + 1,
          quantita: r.quantita || 1,
          // Come nelle rotte: lo zero è un override legittimo
          // («ore incluse: 0»), || null lo cancellava di nascosto.
          overrideOre: r.overrideOre ?? null,
          overridePrezzo: r.overridePrezzo ?? null,
        },
      });
    }

    if (input.dipendenzeDaIds && input.dipendenzeDaIds.length > 0) {
      for (const depId of input.dipendenzeDaIds) {
        await this.prisma.moduloDipendenzaTemplate.create({
          data: {
            tenantId: this.tenantId,
            moduloTemplateId: modulo.id,
            dipendeDaModuloTemplateId: depId,
          },
        });
      }
    }

    return this.prisma.moduloTemplate.findUnique({
      where: { id: modulo.id },
      include: { giurisdizione: true, righeDistinta: { include: { articolo: true } }, dipendenze: true },
    });
  }

  /**
   * Aggiornamento di un template esistente: campi intestazione e, se fornite,
   * sostituzione completa di distinta e dipendenze. Tutto in una transazione:
   * l'aggiornamento e la ricostruzione della distinta devono viaggiare insieme,
   * altrimenti un errore a metà lascerebbe il modulo con una distinta parziale.
   */
  async aggiornaModuloTemplate(
    id: string,
    input: {
      nome?: string;
      categoria?: string;
      giurisdizioneId?: string | null;
      prezzoPacchetto?: number | null;
      righe?: Array<{ articoloId: string; quantita: number; overrideOre?: number; overridePrezzo?: number }>;
      dipendenzeDaIds?: string[];
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      return conContestoInTransazione(tx, async () => {
        const data: Record<string, unknown> = {};
        if (input.nome !== undefined) data.nome = input.nome;
        if (input.categoria !== undefined) data.categoria = input.categoria;
        if (input.giurisdizioneId !== undefined) data.giurisdizioneId = input.giurisdizioneId;
        if (input.prezzoPacchetto !== undefined) data.prezzoPacchetto = input.prezzoPacchetto;
        await tx.moduloTemplate.update({ where: { id }, data });

        if (input.righe) {
          await tx.rigaDistinta.deleteMany({ where: { tenantId: this.tenantId, moduloTemplateId: id } });
          for (const [idx, r] of input.righe.entries()) {
            const art = await tx.articolo.findUniqueOrThrow({ where: { id: r.articoloId } });
            await tx.rigaDistinta.create({
              data: {
                tenantId: this.tenantId,
                moduloTemplateId: id,
                articoloId: r.articoloId,
                articoloVersione: art.versione,
                ordine: idx + 1,
                quantita: r.quantita || 1,
                // Come nelle rotte: lo zero è un override legittimo
                // («ore incluse: 0»), || null lo cancellava di nascosto.
                overrideOre: r.overrideOre ?? null,
                overridePrezzo: r.overridePrezzo ?? null,
              },
            });
          }
        }

        if (input.dipendenzeDaIds) {
          // §7ter — il grafo dev'essere un DAG anche su questa porta: la rotta
          // PUT verifica prima della transazione, ma chi scrive qui senza passare
          // da lì (script, import, uso programmatico) ha la stessa garanzia.
          // La lettura viaggia dentro la transazione: il grafo letto è quello
          // su cui sta per scrivere la deleteMany qui sotto.
          const archi = await tx.moduloDipendenzaTemplate.findMany({
            where: { tenantId: this.tenantId },
            select: { moduloTemplateId: true, dipendeDaModuloTemplateId: true },
          });
          const ciclo = trovaCicloDipendenze(archi, id, input.dipendenzeDaIds);
          if (ciclo) throw new DipendenzaCiclicaError(ciclo.join(' → '));

          await tx.moduloDipendenzaTemplate.deleteMany({ where: { tenantId: this.tenantId, moduloTemplateId: id } });
          for (const depId of input.dipendenzeDaIds) {
            await tx.moduloDipendenzaTemplate.create({
              data: { tenantId: this.tenantId, moduloTemplateId: id, dipendeDaModuloTemplateId: depId },
            });
          }
        }

        return tx.moduloTemplate.findUnique({
          where: { id },
          include: { giurisdizione: true, righeDistinta: { include: { articolo: true } }, dipendenze: true },
        });
      });
    });
  }

  /** §30 — soft delete: il template sparisce dalla libreria ma resta referenziabile dai progetti esistenti. */
  async disattivaModuloTemplate(id: string) {
    await this.prisma.moduloTemplate.update({ where: { id }, data: { isAttivo: false } });
    return { ok: true, id, isAttivo: false };
  }

  async disattivaArticolo(id: string) {
    await this.prisma.articolo.update({ where: { id }, data: { isAttivo: false } });
    return { ok: true, id, isAttivo: false };
  }

  async creaCliente(input: { nome: string; tipo: 'individual' | 'company' }): Promise<Cliente> {
    const c = await this.prisma.cliente.create({
      data: { tenantId: this.tenantId, nome: input.nome, tipo: input.tipo },
    });
    return { id: c.id, nome: c.nome, tipo: c.tipo as 'individual' | 'company' };
  }

  async getCliente(id: string): Promise<Cliente> {
    const c = await this.prisma.cliente.findUnique({ where: { id } });
    if (!c) throw new ClienteNonTrovatoError(`Cliente non trovato: ${id}`);
    return { id: c.id, nome: c.nome, tipo: c.tipo as 'individual' | 'company' };
  }

  async listaClienti(): Promise<Cliente[]> {
    const clienti = await this.prisma.cliente.findMany({ where: { tenantId: this.tenantId } });
    return clienti.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo as 'individual' | 'company' }));
  }

  async creaProgetto(input: { clienteId: string; nome: string }): Promise<ProgettoBase> {
    await this.getCliente(input.clienteId); // lancia se non esiste
    const p = await this.prisma.progetto.create({
      data: { tenantId: this.tenantId, clienteId: input.clienteId, nome: input.nome, stato: 'pre_project', valoreTotale: 0 },
    });
    return { id: p.id, clienteId: p.clienteId, nome: p.nome, stato: p.stato };
  }

  async getProgetto(id: string) {
    const p = await this.prisma.progetto.findUnique({
      where: { id },
      include: {
        cliente: true,
        moduli: {
          include: {
            microvoci: {
              include: {
                passaggi: true,
                // §1ter.6 (C4) — l'assegnatario della micro-voce.
                //
                // Senza questa riga `PUT /progetti/:id/stato-completo` scriverebbe un dato che
                // la lettura non riporta: si assegna un compito, si ricarica il fascicolo, e
                // l'assegnazione sembra di nuovo sparita. Un salvataggio che non si rilegge è
                // indistinguibile da un salvataggio fallito.
                risorsa: { select: { id: true, nome: true, email: true, ruolo: true } },
              },
            },
          },
        },
        fatture: {
          include: { righe: true },
        },
        accessiRisorsa: {
          include: { user: true },
        },
      },
    });
    if (!p) throw new ProgettoNonTrovatoError(`Progetto non trovato: ${id}`);
    return p;
  }

  async listaAccessiProgetto(progettoId: string) {
    return this.prisma.accessoRisorsa.findMany({
      where: { tenantId: this.tenantId, progettoId },
      include: { user: true },
    });
  }

  async assegnaAccessoProgetto(progettoId: string, userId: string, livello: string = 'scrittura') {
    const livEnum = livello === 'read' || livello === 'lettura' ? 'lettura' : 'scrittura';
    const esistente = await this.prisma.accessoRisorsa.findFirst({
      where: { tenantId: this.tenantId, progettoId, userId },
    });
    if (esistente) return esistente;

    return this.prisma.accessoRisorsa.create({
      data: {
        tenantId: this.tenantId,
        livello: livEnum,
        progetto: { connect: { id: progettoId } },
        user: { connect: { id: userId } },
        invitatoDaUser: { connect: { id: userId } },
      },
      include: { user: true, progetto: true },
    });
  }

  /**
   * Sola lettura, e deliberatamente (§2bis).
   *
   * Qui c'era un elenco cablato di cinque persone che veniva riscritto a ogni chiamata con
   * `upsert`. Tre conseguenze, tutte reali e tutte osservate sul database di produzione:
   *
   *  - `update: { tenantId: this.tenantId }` **spostava** quelle righe nello studio che
   *    stava leggendo. Bastava aprire la pagina team da un altro tenant per portarsi via
   *    utenti altrui — esattamente il furto cross-tenant che `POST /tenant/utenti`
   *    respinge con 409, ma per una via che nessun controllo copriva.
   *  - fra quelle righe c'era un `super_admin`, che per §2bis deve avere `tenant_id` NULL.
   *    Riassegnarlo a un tenant lo rendeva un utente ordinario di quello studio, quindi
   *    modificabile dal suo advisor: un advisor poteva declassare il super admin della
   *    piattaforma. La policy RLS su `user` presuppone quell'invariante NULL.
   *  - creava utenti senza `password_hash` e con email divergenti da quelle vere
   *    (`francesca@` accanto a `francesca.disabato@`): righe che non possono accedere e
   *    che restano lì a sporcare l'anagrafica.
   *
   * Il popolamento iniziale è competenza di `seedFull.ts` e `bootstrap.ts`, non di una
   * lettura. Una GET che scrive è un effetto collaterale che nessun chiamante si aspetta.
   */
  async listaUtenti() {
    return this.prisma.user.findMany({
      where: { tenantId: this.tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async creaUtente(input: { nome: string; email: string; ruolo: string }) {
    return this.prisma.user.create({
      data: {
        tenantId: this.tenantId,
        nome: input.nome,
        email: input.email,
        ruolo: (input.ruolo as any) || 'collaboratore_interno',
        stato: 'attivo',
      },
    });
  }

  async listaProgetti() {
    const progetti = await this.prisma.progetto.findMany({
      where: { tenantId: this.tenantId },
      include: {
        cliente: true,
        moduli: {
          include: {
            microvoci: true,
          },
        },
      },
    });
    return progetti;
  }

  async archiviaProgetto(id: string, archiviato: boolean, tenantId?: string): Promise<void> {
    // Stesso schema di `eliminaProgetto`: il tenant della richiesta può differire da
    // quello del costruttore (super_admin che opera su un altro studio via X-Tenant-Id,
    // §2bis), quindi se è passato prevale.
    //
    // L'appartenenza si verifica con un `findFirst` e non filtrando la `update`:
    // `Progetto` ha `id` come unico campo unico, e un `where: { id, tenantId }` sulla
    // update non è affidabile quanto un filtro esplicito — è la stessa ragione per cui
    // `eliminaProgetto` lo fa così. L'isolamento lo doppia comunque la RLS.
    const tenantEffettivo = tenantId ?? this.tenantId;
    const esistente = await this.prisma.progetto.findFirst({
      where: { id, tenantId: tenantEffettivo },
      select: { id: true },
    });
    if (!esistente) {
      throw new ProgettoNonTrovatoError(`Progetto ${id} non trovato in questo studio.`);
    }
    await this.prisma.progetto.update({
      where: { id },
      data: { stato: (archiviato ? 'archived' : 'in_progress') as any },
    });
  }

  async eliminaProgetto(id: string, tenantId?: string): Promise<void> {
    // Il tenant della richiesta HTTP può differire da quello del costruttore
    // (super_admin che opera su un altro studio via X-Tenant-Id, §2bis): se è
    // passato prevale; l'isolamento lo doppiano il filtro esplicito e la RLS.
    const tenantEffettivo = tenantId ?? this.tenantId;
    // Fase 1 — tutto in UN'unica transazione: prima l'eliminazione era una sequenza
    // di ~15 deleteMany non transazionali; un errore a metà (es. una FK non coperta
    // dall'elenco manuale) lasciava il progetto mezzo cancellato — moduli o microvoci
    // orfani, ma record del progetto ancora lì. Con la transazione, o si elimina
    // tutto o non si tocca nulla.
    await this.prisma.$transaction(async (tx) =>
      conContestoInTransazione(tx, async () => {
        // 1. Controllo Fiscale: Se ci sono fatture o note di credito, blocco.
        const fatture = await tx.fattura.count({
          where: { progettoId: id, tenantId: tenantEffettivo },
        });

        if (fatture > 0) {
          throw new TransizioneNonValidaError(
            `Impossibile eliminare il progetto perché contiene ${fatture} Fatture / Note di Credito. È necessario archiviarlo.`,
          );
        }

        // 2. Eliminazione progetto e dipendenze, nell'ordine che evita le FK.
        try {
          // Le dipendenze si raccolgono con due letture e si cancellano con poche
          // `deleteMany ... in`, invece che con tre cicli annidati e una `deleteMany`
          // per modulo e per micro-voce. Il numero di andate e ritorni al database non
          // dipende più da quanto è grande il progetto.
          //
          // Non era solo lentezza: Prisma chiude d'ufficio le transazioni interattive
          // dopo 5 secondi, e su un progetto con abbastanza moduli la vecchia versione
          // li superava. La transazione veniva chiusa a metà, la query successiva
          // falliva con P2028, e l'eliminazione non arrivava mai in fondo.
          const moduli = await tx.moduloProgetto.findMany({
            where: { progettoId: id },
            select: { id: true },
          });
          const moduliIds = moduli.map((m) => m.id);

          if (moduliIds.length > 0) {
            const microvoci = await tx.microvoceProgetto.findMany({
              where: { moduloProgettoId: { in: moduliIds } },
              select: { id: true },
            });
            const microvociIds = microvoci.map((mv) => mv.id);

            if (microvociIds.length > 0) {
              await tx.passaggioProgetto.deleteMany({
                where: { microvoceProgettoId: { in: microvociIds } },
              });
            }
            await tx.microvoceProgetto.deleteMany({
              where: { moduloProgettoId: { in: moduliIds } },
            });
            // Le due direzioni della dipendenza in una sola passata: prima erano due
            // deleteMany per ogni modulo.
            await tx.moduloProgettoDipendenza.deleteMany({
              where: {
                OR: [
                  { dipendeDaModuloProgettoId: { in: moduliIds } },
                  { moduloProgettoId: { in: moduliIds } },
                ],
              },
            });
          }
          await tx.moduloProgetto.deleteMany({ where: { progettoId: id } });

          await tx.preventivo.deleteMany({ where: { progettoId: id } });

          await tx.eventoCalendario.deleteMany({ where: { progettoId: id } });
          await tx.accessoRisorsa.deleteMany({ where: { progettoId: id } });
          await tx.comunicazioneProgetto.deleteMany({ where: { progettoId: id } });
          // La chat di un cliente agganciata a questa pratica. Il cascade sulla FK la
          // porterebbe via comunque: la riga esplicita è qui perché l'elenco è il
          // contratto di questo metodo — chi aggiunge una tabella che punta a
          // `progetto` la trova qui invece di scoprirla da un P2003 in produzione.
          await tx.collegamentoChatProgetto.deleteMany({ where: { progettoId: id } });

          // Prisma accetta solo campi unique nel where della delete (e `id` è
          // l'unico unique di Progetto): il vecchio `{ id, tenantId }` lanciava
          // un errore di validazione che finiva mascherato da «record collegati».
          // L'appartenenza al tenant si verifica prima, l'isolamento lo fa anche
          // la RLS dentro questa transazione.
          const esistente = await tx.progetto.findFirst({ where: { id, tenantId: tenantEffettivo } });
          if (!esistente) {
            throw new ProgettoNonTrovatoError(`Progetto ${id} non trovato in questo studio.`);
          }
          await tx.progetto.delete({ where: { id } });
        } catch (err: any) {
          // ProgettoNonTrovatoError va rilanciato com'è: il gestore centrale degli
          // errori lo traduce in 404; mascherarlo qui produrrebbe un 409 fuorviante.
          if (err instanceof TransizioneNonValidaError || err instanceof ProgettoNonTrovatoError) throw err;
          // Solo la violazione di chiave esterna significa davvero «record collegati»:
          // è l'unico caso in cui questa spiegazione è vera. Un tempo ci finiva dentro
          // QUALUNQUE errore, e così un timeout di transazione (P2028) si presentava
          // all'operatore come un progetto con record collegati che non esistevano —
          // una diagnosi inventata, che manda a cercare la causa nel posto sbagliato.
          // Il caso «ci sono fatture» ha già il suo ramo esplicito qui sopra; tutto il
          // resto esce com'è, il gestore centrale lo traduce in 500 e il log dice la verità.
          console.error('Errore durante eliminazione progetto:', err);
          if (err?.code === 'P2003') {
            throw new TransizioneNonValidaError('Impossibile eliminare il progetto a causa di record collegati nel database.');
          }
          throw err;
        }
      }),
      // Il tetto esplicito è largo di proposito: qui dentro si leggono e si cancellano
      // decine di righe, e il default di Prisma (5 secondi) non basta su un progetto
      // grande. Una transazione lunga è meglio di un'eliminazione che fallisce a metà.
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  async listaFattureTutte(): Promise<any[]> {
    return this.prisma.fattura.findMany({
      where: { tenantId: this.tenantId },
      include: {
        progetto: {
          include: {
            cliente: true
          }
        },
      },
      orderBy: { data: 'desc' }
    });
  }

  async creaPreventivo(input: {
    clienteId: string;
    progettoId: string;
    righe: Array<{ moduloTemplateId: string; moduloTemplateVersione: number }>;
  }): Promise<Preventivo> {
    await this.getCliente(input.clienteId);
    await this.getProgetto(input.progettoId);
    if (input.righe.length === 0) throw new Error('Un preventivo deve avere almeno una riga');

    let valoreTotale = 0;
    for (const riga of input.righe) {
      // NB: apre una transazione solo per una lettura — funzionalmente corretto ma
      // inefficiente se il preventivo ha molte righe. Andrebbe estratta una lettura
      // diretta non transazionale quando si rifinisce questo adapter; lasciato così
      // per ora perché non è un bug, solo un margine di ottimizzazione.
      const template = await this.istanziazione
        .eseguiInTransazione((tx) => tx.getModuloTemplateConDistinta(riga.moduloTemplateId, riga.moduloTemplateVersione))
        .catch(() => null);
      if (!template) throw new ModuloNonTrovatoError(`Modulo non trovato in libreria: ${riga.moduloTemplateId}@${riga.moduloTemplateVersione}`);
      valoreTotale += calcolaPrezzoModulo(template);
    }

    const p = await this.prisma.preventivo.create({
      data: {
        tenantId: this.tenantId,
        clienteId: input.clienteId,
        progettoId: input.progettoId,
        stato: 'bozza',
        righeJson: input.righe as never,
        valoreTotale,
      },
    });
    return { id: p.id, clienteId: p.clienteId, progettoId: p.progettoId, righe: input.righe, valoreTotale: p.valoreTotale, stato: p.stato };
  }

  async getPreventivo(id: string): Promise<Preventivo> {
    const p = await this.prisma.preventivo.findUnique({ where: { id } });
    if (!p) throw new PreventivoNonTrovatoError(`Preventivo non trovato: ${id}`);
    return { id: p.id, clienteId: p.clienteId, progettoId: p.progettoId, righe: p.righeJson as never, valoreTotale: p.valoreTotale, stato: p.stato };
  }

  async inviaPreventivo(id: string): Promise<Preventivo> {
    const p = await this.getPreventivo(id);
    if (p.stato !== 'bozza') throw new TransizioneNonValidaError(`Solo un preventivo in bozza può essere inviato (stato attuale: ${p.stato})`);
    const aggiornato = await this.prisma.preventivo.update({ where: { id }, data: { stato: 'inviato' } });
    return { ...p, stato: aggiornato.stato };
  }

  async accettaPreventivoEIstanzia(id: string) {
    const p = await this.getPreventivo(id);
    if (p.stato !== 'bozza' && p.stato !== 'inviato') {
      throw new TransizioneNonValidaError(`Preventivo in stato ${p.stato} non può essere accettato`);
    }

    // §15.3 — l'istanziazione vera, stessa funzione già testata con la porta finta
    // (src/services/istanziaProgetto.test.ts), qui usata con la porta Prisma reale.
    // L'accettazione del preventivo passa come `preventivoId`: il passaggio di stato avviene
    // DENTRO la stessa transazione dell'istanziazione. Prima era un update separato fatto
    // prima: se l'istanziazione faceva rollback (capitava: il timeout di 5 secondi scattava
    // a un soffio dal completamento) restava un preventivo «accettato» senza moduli, e non
    // più riprovabile perché il controllo qui sopra lo avrebbe rifiutato.
    return istanziaProgetto(
      { progettoId: p.progettoId, clienteId: p.clienteId, righe: p.righe, preventivoId: id },
      this.istanziazione,
      this.notifiche,
    );
  }

  // ── §17 — esecuzione: delega diretta al servizio, con la porta Prisma già scritta sopra ──

  async emettiFattura(input: {
    progettoId: string;
    tipoClienteFiscale: 'privato_italia' | 'business_italia' | 'estero';
    partitaIva?: string;
    codiceFiscale?: string;
    canale: 'sdi' | 'standard';
    righe: Array<{
      tipo: 'modulo_completo' | 'modulo_parziale' | 'milestone_libera';
      moduloProgettoId?: string;
      percentuale?: number;
      importo: number;
      descrizione: string;
    }>;
  }) {
    let prog = await this.prisma.progetto.findUnique({ where: { id: input.progettoId }, include: { cliente: true, moduli: true } });
    if (!prog) {
      prog = await this.prisma.progetto.findFirst({
        where: { tenantId: this.tenantId, OR: [{ id: input.progettoId }, { nome: { contains: input.progettoId, mode: 'insensitive' } }] },
        include: { cliente: true, moduli: true },
      });
    }
    let clienteId = prog?.clienteId || '';
    if (!clienteId) {
      const primoCliente = await this.prisma.cliente.findFirst({ where: { tenantId: this.tenantId } });
      clienteId = primoCliente?.id || '';
    }
    if (!clienteId) throw new Error('Cliente del progetto non trovato');

    const validModuliIds = new Set((prog?.moduli || []).map(m => m.id));

    const dataEmissione = new Date();
    const anno = dataEmissione.getFullYear();
    const lastFattura = await this.prisma.fattura.findFirst({
      where: { tenantId: this.tenantId, serie: 'FT', stato: { not: 'bozza' } },
      orderBy: { numeroProgressivoSerie: 'desc' },
    });
    const nextProgressivo = (lastFattura?.numeroProgressivoSerie || 0) + 1;
    const numeroUfficiale = `FT-${anno}/${nextProgressivo.toString().padStart(3, '0')}`;

    // Calcolo righe e scorporo IVA 22%
    const righeCalcolate = input.righe.map((r, idx) => {
      const totRiga = Math.abs(r.importo);
      const impRiga = Math.round(totRiga / 1.22);
      const ivaRiga = totRiga - impRiga;
      const safeModuloId = (r.moduloProgettoId && validModuliIds.has(r.moduloProgettoId)) ? r.moduloProgettoId : null;
      return {
        tenantId: this.tenantId,
        tipo: r.tipo,
        moduloProgettoId: safeModuloId,
        percentuale: r.percentuale || null,
        importo: totRiga,
        descrizione: r.descrizione,
        quantita: 1,
        unitaMisura: 'forfait',
        prezzoUnitarioCent: impRiga,
        scontoPercentuale: 0,
        aliquotaIva: 22,
        naturaEsenzione: null,
        applicaCassa: false,
        applicaRitenuta: false,
        applicaBollo: false,
        imponibileCentesimi: impRiga,
        ivaCentesimi: ivaRiga,
        totaleRigaCentesimi: totRiga,
        ordine: idx + 1,
      };
    });

    const totDocCent = righeCalcolate.reduce((acc, r) => acc + r.totaleRigaCentesimi, 0);
    const totImpCent = righeCalcolate.reduce((acc, r) => acc + r.imponibileCentesimi, 0);
    const totIvaCent = righeCalcolate.reduce((acc, r) => acc + r.ivaCentesimi, 0);

    const dataScadenza = new Date();
    dataScadenza.setDate(dataScadenza.getDate() + 30);

    const fattura = await this.prisma.fattura.create({
      data: {
        tenantId: this.tenantId,
        clienteId,
        progettoId: prog?.id || input.progettoId,
        tipoDocumento: 'fattura',
        serie: 'FT',
        numeroProgressivoSerie: nextProgressivo,
        numero: numeroUfficiale,
        data: dataEmissione,
        stato: 'emessa',
        tipoClienteFiscale: input.tipoClienteFiscale,
        partitaIva: input.partitaIva || prog?.cliente?.piva || null,
        codiceFiscale: input.codiceFiscale || prog?.cliente?.codiceFiscale || null,
        canale: input.canale,
        statoSdi: 'n_a',
        condizionePagamento: 'bonifico_30gg',
        metodoPagamento: 'bonifico',
        tipoCassa: 'nessuna',
        aliquotaCassa: 0,
        aliquotaRitenuta: 0,
        esigibilitaIva: 'immediata',
        totaleImponibileCentesimi: totImpCent,
        totaleCassaCentesimi: 0,
        totaleIvaCentesimi: totIvaCent,
        totaleRitenutaCentesimi: 0,
        totaleBolloCentesimi: 0,
        totaleDocumentoCentesimi: totDocCent,
        nettoAPagareCentesimi: totDocCent,
        codiceDestinatario: prog?.cliente?.sdiCode || '0000000',
        righe: {
          create: righeCalcolate,
        },
        scadenzeIncasso: {
          create: [
            {
              tenantId: this.tenantId,
              numeroRata: 1,
              importoCentesimi: totDocCent,
              dataScadenza,
              stato: 'in_attesa',
            },
          ],
        },
        auditLogFatture: {
          create: {
            tenantId: this.tenantId,
            azione: 'emissione',
            dettagli: {
              numero: numeroUfficiale,
              totaleDocumentoCentesimi: totDocCent,
            },
          },
        },
      },
      include: { righe: true, scadenzeIncasso: true, cliente: true, progetto: true },
    });

    return fattura;
  }

  async consuntivaMicrovoce(input: { microvoceId: string; oreAggiunte: number; completa?: boolean }) {
    const mv = await this.prisma.microvoceProgetto.findUniqueOrThrow({ where: { id: input.microvoceId } });
    const nuoveOre = mv.oreConsuntivate + input.oreAggiunte;
    const nuovoStato = input.completa ? 'done' : mv.stato === 'pending' || mv.stato === 'attesa_dipendenza' ? 'active' : mv.stato;

    const aggiornata = await this.prisma.microvoceProgetto.update({
      where: { id: input.microvoceId },
      data: {
        oreConsuntivate: nuoveOre,
        stato: nuovoStato,
      },
    });

    // Se completata, verifica se tutte le microvoci del modulo sono done per aggiornare il modulo
    if (input.completa) {
      const allMv = await this.prisma.microvoceProgetto.findMany({ where: { moduloProgettoId: mv.moduloProgettoId } });
      const allDone = allMv.every((m) => m.stato === 'done' || m.id === input.microvoceId);
      if (allDone) {
        await this.prisma.moduloProgetto.update({
          where: { id: mv.moduloProgettoId },
          data: { stato: 'done' },
        });
      }
    }

    return aggiornata;
  }

  async marcaRitardoMicrovoce(microvoceId: string, stato: 'delayed' | 'blocked', causaNota: string): Promise<void> {
    await marcaRitardo(microvoceId, stato, causaNota, this.istanziazione);
  }

  async risolviRitardoMicrovoce(microvoceId: string): Promise<void> {
    await risolviRitardo(microvoceId, this.istanziazione);
  }

  async completaMicrovoce(microvoceId: string): Promise<void> {
    await completaMicrovoceService(microvoceId, this.istanziazione);
  }

  async getMicrovoce(microvoceId: string) {
    return this.istanziazione.getMicrovoce(microvoceId);
  }

  async getPassaggiDellaMicrovoce(microvoceId: string) {
    return this.istanziazione.getPassaggiDellaMicrovoce(microvoceId);
  }

  async completaPassaggioDocumento(passaggioId: string): Promise<void> {
    await completaPassaggioDocumentoService(passaggioId, this.istanziazione);
  }

  async completaPassaggioForm(passaggioId: string): Promise<void> {
    await completaPassaggioFormService(passaggioId, this.istanziazione);
  }

  async marcaPassaggioCompletato(passaggioId: string): Promise<void> {
    await marcaPassaggioCompletatoService(passaggioId, this.istanziazione);
  }
}
