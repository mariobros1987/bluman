// Implementazione reale di AppPort sopra Postgres — funziona con qualunque Postgres
// raggiungibile via DATABASE_URL, incluso Supabase (è solo Postgres gestito: non serve
// nulla di specifico a Supabase, basta la connection string dalla sua dashboard).
//
// ⚠️ Come gli altri file in questa cartella, mai compilato né eseguito in questo ambiente
// (rete bloccata verso binaries.prisma.sh). Verificalo sulla tua macchina — vedi
// ISTRUZIONI_INSTALLAZIONE.md, Percorso B.

import type { PrismaConContesto } from '../../util/prismaClient.js';
import { PrismaIstanziazionePort } from './prismaIstanziazionePort.js';
import { istanziaProgetto, calcolaPrezzoModulo } from '../../services/istanziaProgetto.js';
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
} from '../appErrors.js';

/** Notifiche via console.log — stub in attesa del servizio email reale (§10, §22). */
class ConsoleNotificationPort implements NotificationPort {
  async notificaProgettoAvviato(input: { progettoId: string; clienteId: string; moduliProgettoIds: string[] }): Promise<void> {
    console.log('[notifica] Progetto avviato:', input.progettoId, '— moduli:', input.moduliProgettoIds.length);
  }
}

export class PrismaApp implements AppPort {
  private readonly istanziazione: PrismaIstanziazionePort;
  private readonly notifiche = new ConsoleNotificationPort();
  private readonly tenantId: string;

  constructor(private readonly prisma: PrismaConContesto, tenantId: string) {
    this.tenantId = tenantId;
    this.istanziazione = new PrismaIstanziazionePort(prisma, tenantId);
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
    prezzoPacchetto?: number | null;
    righe: Array<{ articoloId: string; quantita: number; overrideOre?: number; overridePrezzo?: number }>;
    dipendenzeDaIds?: string[];
  }) {
    const modulo = await this.prisma.moduloTemplate.create({
      data: {
        tenantId: this.tenantId,
        nome: input.nome,
        categoria: input.categoria,
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
          overrideOre: r.overrideOre || null,
          overridePrezzo: r.overridePrezzo || null,
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
      include: { righeDistinta: { include: { articolo: true } }, dipendenze: true },
    });
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

  async archiviaProgetto(id: string, archiviato: boolean): Promise<void> {
    await this.prisma.progetto.update({
      where: { id, tenantId: this.tenantId },
      data: { stato: (archiviato ? 'archived' : 'in_progress') as any },
    });
  }

  async eliminaProgetto(id: string): Promise<void> {
    // 1. Controllo Fiscale: Se ci sono fatture o note di credito, blocco.
    const fatture = await this.prisma.fattura.count({
      where: { progettoId: id, tenantId: this.tenantId },
    });
    
    if (fatture > 0) {
      throw new TransizioneNonValidaError(
        `Impossibile eliminare il progetto perché contiene ${fatture} Fatture / Note di Credito. È necessario archiviarlo.`
      );
    }
    
    // 2. Eliminazione progetto
    // Il database eliminerà a cascata (Cascade) le righe correlate oppure potremmo doverle eliminare manualmente se Prisma non è configurato per il cascade completo.
    // Facciamo un tentativo. In caso di errore per FK constraint, dovremo eliminare prima le dipendenze.
    try {
      // Elimina manualmente prima le dipendenze note per sicurezza se non c'è cascade ovunque
      const moduli = await this.prisma.moduloProgetto.findMany({ where: { progettoId: id } });
      for (const m of moduli) {
        await this.prisma.moduloProgettoDipendenza.deleteMany({ where: { dipendeDaModuloProgettoId: m.id } });
        await this.prisma.moduloProgettoDipendenza.deleteMany({ where: { moduloProgettoId: m.id } });
        const microvoci = await this.prisma.microvoceProgetto.findMany({ where: { moduloProgettoId: m.id } });
        for (const mv of microvoci) {
          await this.prisma.passaggioProgetto.deleteMany({ where: { microvoceProgettoId: mv.id } });
        }
        await this.prisma.microvoceProgetto.deleteMany({ where: { moduloProgettoId: m.id } });
      }
      await this.prisma.moduloProgetto.deleteMany({ where: { progettoId: id } });
      
      await this.prisma.preventivo.deleteMany({ where: { progettoId: id } });
      
      await this.prisma.eventoCalendario.deleteMany({ where: { progettoId: id } });
      await this.prisma.accessoRisorsa.deleteMany({ where: { progettoId: id } });
      await this.prisma.comunicazioneProgetto.deleteMany({ where: { progettoId: id } });

      await this.prisma.progetto.delete({
        where: { id, tenantId: this.tenantId },
      });
    } catch (err: any) {
      console.error('Errore durante eliminazione progetto:', err);
      throw new TransizioneNonValidaError('Impossibile eliminare il progetto a causa di record collegati nel database.');
    }
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
    const countFatture = await this.prisma.fattura.count({ where: { tenantId: this.tenantId } });
    const numeroProgressivo = `FT-2026-${(countFatture + 1).toString().padStart(4, '0')}`;
    const totale = input.righe.reduce((acc, r) => acc + r.importo, 0);

    const fattura = await this.prisma.fattura.create({
      data: {
        tenantId: this.tenantId,
        progettoId: input.progettoId,
        numero: numeroProgressivo,
        numeroProgressivo,
        data: new Date(),
        stato: 'emessa',
        tipoClienteFiscale: input.tipoClienteFiscale,
        partitaIva: input.partitaIva || null,
        codiceFiscale: input.codiceFiscale || null,
        canale: input.canale,
        statoSdi: input.canale === 'sdi' ? 'consegnata' : 'n_a',
        righe: {
          create: input.righe.map((r) => ({
            tenantId: this.tenantId,
            tipo: r.tipo,
            moduloProgettoId: r.moduloProgettoId || null,
            percentuale: r.percentuale || null,
            importo: r.importo,
            descrizione: r.descrizione,
          })),
        },
      },
      include: { righe: true },
    });

    // ── OpenSTAManager Model: Generazione automatica Scadenzario Incasso a 30gg ──
    const dataScadenza = new Date();
    dataScadenza.setDate(dataScadenza.getDate() + 30);

    await (this.prisma as any).scadenzaIncasso.create({
      data: {
        tenantId: this.tenantId,
        fatturaId: fattura.id,
        numeroRata: 1,
        importoCentesimi: totale,
        dataScadenza,
        stato: 'in_attesa',
      },
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
