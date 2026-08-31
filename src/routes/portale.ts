// Rotte portale cliente: §2.6 contatti, §2.11 fatture e stato di pagamento,
// §2.3 dati fiscali (proposte-dati: il cliente propone, lo studio conferma),
// §2.5 addendum.
//
// Estratte da `src/server.ts` (split dei monoliti, 27/08/2026) SENZA cambio di
// comportamento: stesse identiche implementazioni, solo spostate qui perché il
// monolite resti leggibile. Nel monolite le quattro sotto-sezioni formavano un
// unico blocco contiguo (dopo le rotte FEA di richiesta-modifica, prima della
// rotta canali-firma): qui restano nell'ordine di registrazione originale.
// NB: l'helper `clienteDellaRichiesta` viveva nella sezione FEA del monolite
// (PRIMA di questo blocco) ed era visibile solo per hoisting delle function
// declaration; con lo split è stato spostato in `src/util/serverHelpers.ts`
// perché usato sia qui sia dalle rotte FEA/firma rimaste nel monolite.
// `registraRottePortale` viene chiamata DENTRO il wrapper
// `server.register(...)` di `buildServer`, quindi il rate-limit e l'hook auth
// onRequest continuano ad applicarsi esattamente come prima (stesso contesto di
// incapsulamento, nessuna nuova barriera).

import type { FastifyInstance } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { notificaStudio, notificaCliente } from '../services/notificheService.js';
import { recordAudit, clienteDellaRichiesta } from '../util/serverHelpers.js';

// ─── PORTALE CLIENTE (§2.6, §2.11, §2.3, §2.5) ─────────────────────
export async function registraRottePortale(server: FastifyInstance): Promise<void> {
  // ────────────────────────────────────────────────────────────────
  // §2.6 — CONTATTI DEL PORTALE: il riferimento è il lead advisor del tenant.
  //
  // Prima la scheda "Contatto Advisor" mostrava un nome, un'email e un telefono scritti
  // nel codice, più un pallino "Advisor Online" che non rifletteva alcuno stato reale.
  // Qui si restituisce il recapito vero del responsabile dello studio, letto dal tenant,
  // e il frontend lo mostra senza inventare presenze.
  // ────────────────────────────────────────────────────────────────
  server.get('/portal/contatti', async (req, reply) => {
    const tenantId = req.tenantId;
    const clienteId = clienteDellaRichiesta(req, (req.query as any)?.clienteId);
    if (!clienteId) {
      return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    }
    try {
      // Il cliente deve appartenere al tenant della sessione: il riferimento cambia da
      // studio a studio, non è un dato globale.
      const cliente = await prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
        select: { id: true },
      });
      if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato.' });

      const tenant = await prisma.tenant.findFirst({
        where: { id: tenantId },
        select: {
          ragioneSociale: true,
          leadAdvisorNome: true,
          leadAdvisorEmail: true,
          telefono: true,
          email: true,
          sedeLegale: true,
        },
      });
      if (!tenant) return reply.code(404).send({ errore: 'Studio non trovato.' });

      return reply.send({
        ok: true,
        contatti: {
          studio: tenant.ragioneSociale || null,
          advisorNome: tenant.leadAdvisorNome || null,
          advisorEmail: tenant.leadAdvisorEmail || null,
          telefono: tenant.telefono || null,
          emailStudio: tenant.email || null,
          sedeLegale: tenant.sedeLegale || null,
        },
      });
    } catch (err) {
      return reply.code(500).send({
        errore: err instanceof Error ? err.message : 'Errore lettura contatti dello studio',
      });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // §2.11 — FATTURE E STATO DI PAGAMENTO NEL PORTALE CLIENTE.
  //
  // Il cliente vede le fatture dei suoi progetti: numero, data, importo e stato del
  // pagamento. Le bozze restano allo studio — una fattura non emessa non è un documento
  // del cliente. L'importo è la somma delle righe (centesimi, mai float per il denaro).
  // ────────────────────────────────────────────────────────────────
  server.get('/portal/fatture', async (req, reply) => {
    const tenantId = req.tenantId;
    const clienteId = clienteDellaRichiesta(req, (req.query as any)?.clienteId);
    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    try {
      const fatture = await prisma.fattura.findMany({
        where: {
          tenantId,
          progetto: { clienteId },
          // Solo ciò che esiste per il cliente: la bozza è lavoro interno dello studio.
          stato: { in: ['emessa', 'incassata'] },
        },
        include: {
          progetto: { select: { id: true, nome: true } },
          righe: { select: { importo: true } },
          scadenzeIncasso: {
            where: { stato: 'in_attesa' },
            orderBy: { dataScadenza: 'asc' },
            select: { dataScadenza: true, importoCentesimi: true },
            take: 1,
          },
        },
        orderBy: { data: 'desc' },
      });

      const elenco = fatture.map((f) => {
        const totaleCentesimi = f.righe.reduce((somma, r) => somma + (r.importo || 0), 0);
        const prossimaScadenza = f.scadenzeIncasso[0] ?? null;
        return {
          id: f.id,
          numero: f.numero || `${f.serie}-${f.numeroProgressivoSerie}`,
          tipoDocumento: f.tipoDocumento,
          data: f.data,
          stato: f.stato,
          pagata: f.stato === 'incassata',
          totaleCentesimi,
          progettoId: f.progettoId,
          progetto: f.progetto?.nome ?? null,
          prossimaScadenza: prossimaScadenza
            ? { dataScadenza: prossimaScadenza.dataScadenza, importoCentesimi: prossimaScadenza.importoCentesimi }
            : null,
        };
      });

      return reply.send({ ok: true, fatture: elenco });
    } catch (err) {
      return reply.code(500).send({
        errore: err instanceof Error ? err.message : 'Errore lettura fatture',
      });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // §2.3 — DATI FISCALI: il cliente PROPONE, lo studio CONFERMA.
  //
  // Il cliente non scrive direttamente in anagrafica: invia una proposta che resta
  // `in_attesa` finché lo studio non la conferma (e solo allora il valore entra nella
  // riga del cliente) o la rifiuta con una motivazione. Una sola proposta pendente per
  // campo: ridigitare sostituisce la richiesta precedente.
  // ────────────────────────────────────────────────────────────────

  /** Campi che il cliente può proporre e come si traducono in un update di `cliente`. */
  const CAMPI_PROPONIBILI = ['piva', 'codiceFiscale', 'iban', 'titolareEffettivo', 'ragioneSociale', 'sedeLegale', 'legaleRappresentante'] as const;
  type CampoProponibile = (typeof CAMPI_PROPONIBILI)[number];

  // Punto 4 piano gap — il nome tecnico del campo non parla né al cliente né allo studio:
  // nelle notifiche va l'etichetta in chiaro («Partita IVA», non «piva»).
  const ETICHETTE_CAMPI_PROPONIBILI: Record<CampoProponibile, string> = {
    piva: 'Partita IVA',
    codiceFiscale: 'Codice fiscale',
    iban: 'IBAN',
    titolareEffettivo: 'Titolare effettivo',
    ragioneSociale: 'Ragione sociale',
    sedeLegale: 'Sede legale',
    legaleRappresentante: 'Legale rappresentante',
  };

  function campoProponibile(valore: unknown): valore is CampoProponibile {
    return typeof valore === 'string' && (CAMPI_PROPONIBILI as readonly string[]).includes(valore);
  }

  /**
   * Traduce campo+valore in un oggetto di update Prisma per `cliente`.
   * `legaleRappresentante` vive dentro `referentiJson`, quindi restituisce anche il JSON
   * aggiornato da scrivere. Ritorna null se il campo non è mappabile.
   */
  function aggiornaClientePerCampo(campo: CampoProponibile, valore: string, referentiJson: any): Record<string, any> | null {
    switch (campo) {
      case 'piva': return { piva: valore };
      case 'codiceFiscale': return { codiceFiscale: valore };
      case 'iban': return { iban: valore };
      case 'titolareEffettivo': return { ubo: valore };
      case 'ragioneSociale': return { nome: valore };
      case 'sedeLegale': return { sedeLegale: valore };
      case 'legaleRappresentante': {
        const referenti = referentiJson && typeof referentiJson === 'object' ? referentiJson : {};
        return { referentiJson: { ...referenti, legaleRappresentante: valore } };
      }
      default: return null;
    }
  }

  /** Il valore attuale di un campo sulla riga del cliente, per mostrarlo al cliente. */
  function valoreAttualeCliente(campo: CampoProponibile, cliente: any): string | null {
    switch (campo) {
      case 'piva': return cliente.piva ?? null;
      case 'codiceFiscale': return cliente.codiceFiscale ?? null;
      case 'iban': return cliente.iban ?? null;
      case 'titolareEffettivo': return cliente.ubo ?? null;
      case 'ragioneSociale': return cliente.nome ?? null;
      case 'sedeLegale': return cliente.sedeLegale ?? null;
      case 'legaleRappresentante': {
        const referenti = cliente.referentiJson && typeof cliente.referentiJson === 'object' ? cliente.referentiJson : {};
        return referenti.legaleRappresentante ?? null;
      }
      default: return null;
    }
  }

  // Lato cliente: legge le proprie proposte (per mostrare lo stato di quelle inviate).
  server.get('/portal/proposte-dati', async (req, reply) => {
    const tenantId = req.tenantId;
    const clienteId = clienteDellaRichiesta(req, (req.query as any)?.clienteId);
    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    try {
      const proposte = await prisma.propostaDatiFiscale.findMany({
        where: { tenantId, clienteId },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send({ ok: true, proposte });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura proposte dati' });
    }
  });

  // Lato cliente: invia (o sostituisce, se già pendente) una proposta per un campo.
  server.post<{ Body: { campo: string; valoreProposto: string; notaCliente?: string; clienteId?: string } }>('/portal/proposte-dati', async (req, reply) => {
    const tenantId = req.tenantId;
    const clienteId = clienteDellaRichiesta(req, req.body?.clienteId);
    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });

    const { campo, valoreProposto, notaCliente } = req.body || {};
    if (!campoProponibile(campo)) {
      return reply.code(400).send({ errore: 'Campo non proponibile.' });
    }
    const valore = (valoreProposto ?? '').trim();
    if (!valore) return reply.code(400).send({ errore: 'Il valore proposto è obbligatorio.' });

    try {
      const cliente = await prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
        select: { id: true, piva: true, codiceFiscale: true, iban: true, ubo: true, nome: true, sedeLegale: true, referentiJson: true },
      });
      if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato.' });

      const attuale = valoreAttualeCliente(campo, cliente);
      if (attuale === valore) {
        return reply.code(400).send({ errore: 'Il valore proposto è uguale a quello già registrato.' });
      }

      // Una sola proposta pendente per campo: se esiste, la sostituiamo.
      const pendente = await prisma.propostaDatiFiscale.findFirst({
        where: { tenantId, clienteId, campo, stato: 'in_attesa' },
      });
      const dati = {
        tenantId,
        clienteId,
        campo,
        valoreAttuale: attuale,
        valoreProposto: valore,
        notaCliente: (notaCliente ?? '').trim() || null,
        richiestoDaId: req.user?.userId ?? null,
      };
      const proposta = pendente
        ? await prisma.propostaDatiFiscale.update({ where: { id: pendente.id }, data: { valoreAttuale: attuale, valoreProposto: valore, notaCliente: dati.notaCliente } })
        : await prisma.propostaDatiFiscale.create({ data: { ...dati, stato: 'in_attesa' } });

      await recordAudit({
        tenantId,
        userId: req.user?.userId ?? null,
        azione: 'PROPOSTA_DATO_FISCALE',
        entita: proposta.id,
        dettagli: `Proposta modifica ${campo} per cliente ${clienteId}`,
      });

      // Punto 4 piano gap (gap simmetrico cliente→studio) — la proposta di modifica dati è
      // un messaggio del cliente allo studio: la campanella deve suonare. Le proposte si
      // gestiscono dalla scheda cliente, da qui il link alla pagina clienti.
      await notificaStudio(tenantId, {
        tipoEvento: 'messaggio_cliente',
        oggetto: 'Proposta di modifica dati',
        corpo: `${cliente.nome} propone di modificare ${ETICHETTE_CAMPI_PROPONIBILI[campo]}: «${valore.slice(0, 80)}»`,
        link: '/clients',
      }).catch(() => {});

      return reply.code(201).send({ ok: true, proposta });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore invio proposta dati' });
    }
  });

  // Lato studio: elenca le proposte del tenant (filtrabili per cliente e stato).
  server.get('/proposte-dati', async (req, reply) => {
    if (req.ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });
    const tenantId = req.tenantId || '00000000-0000-0000-0000-000000000001';
    const query = req.query as any;
    try {
      const proposte = await prisma.propostaDatiFiscale.findMany({
        where: {
          tenantId,
          ...(query.clienteId ? { clienteId: String(query.clienteId) } : {}),
          ...(query.stato ? { stato: String(query.stato) as any } : {}),
        },
        include: { cliente: { select: { id: true, nome: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send({ ok: true, proposte });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura proposte dati' });
    }
  });

  // Lato studio: conferma una proposta e applica il valore alla riga del cliente.
  server.post<{ Params: { id: string } }>('/proposte-dati/:id/conferma', async (req, reply) => {
    if (req.ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });
    const tenantId = req.tenantId || '00000000-0000-0000-0000-000000000001';
    const { id } = req.params;
    try {
      const proposta = await prisma.propostaDatiFiscale.findFirst({
        where: { id, tenantId },
        include: { cliente: { select: { id: true, referentiJson: true } } },
      });
      if (!proposta) return reply.code(404).send({ errore: 'Proposta non trovata.' });
      if (proposta.stato !== 'in_attesa') {
        return reply.code(400).send({ errore: 'La proposta è già stata gestita.' });
      }
      if (!campoProponibile(proposta.campo)) {
        return reply.code(400).send({ errore: 'Campo della proposta non valido.' });
      }
      const update = aggiornaClientePerCampo(proposta.campo as CampoProponibile, proposta.valoreProposto, proposta.cliente.referentiJson);
      if (!update) return reply.code(400).send({ errore: 'Impossibile applicare il campo proposto.' });

      // Prima si scrive il valore in anagrafica, poi si marca la proposta: se l'update del
      // cliente fallisce, la proposta resta pendente invece di risultare confermata invano.
      await prisma.cliente.update({ where: { id: proposta.clienteId }, data: update });
      const confermata = await prisma.propostaDatiFiscale.update({
        where: { id: proposta.id },
        data: { stato: 'confermata', gestitoDaId: req.user?.userId ?? null },
      });

      await recordAudit({
        tenantId,
        userId: req.user?.userId ?? null,
        azione: 'DATO_FISCALE_CONFERMATO',
        entita: proposta.id,
        dettagli: `Confermata modifica ${proposta.campo} per cliente ${proposta.clienteId}`,
      });

      // Punto 4 piano gap, riga 8 matrice — l'esito della proposta va comunicato al cliente:
      // l'anagrafica è cambiata e la sua richiesta ha una risposta. Le proposte vivono nella
      // tab «Proposta» del portale.
      await notificaCliente(tenantId, proposta.clienteId, {
        tipoEvento: 'risposta_proposta_dati',
        oggetto: 'Proposta di modifica accettata',
        corpo: `Lo studio ha confermato la modifica di ${ETICHETTE_CAMPI_PROPONIBILI[proposta.campo]}: il nuovo valore è attivo in anagrafica.`,
        link: '/portal/proposal',
      }).catch(() => {});

      return reply.send({ ok: true, proposta: confermata });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore conferma proposta' });
    }
  });

  // Lato studio: rifiuta una proposta, con motivazione facoltativa.
  server.post<{ Params: { id: string }; Body: { notaStudio?: string } }>('/proposte-dati/:id/rifiuta', async (req, reply) => {
    if (req.ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });
    const tenantId = req.tenantId || '00000000-0000-0000-0000-000000000001';
    const { id } = req.params;
    try {
      const proposta = await prisma.propostaDatiFiscale.findFirst({ where: { id, tenantId } });
      if (!proposta) return reply.code(404).send({ errore: 'Proposta non trovata.' });
      if (proposta.stato !== 'in_attesa') {
        return reply.code(400).send({ errore: 'La proposta è già stata gestita.' });
      }
      const rifiutata = await prisma.propostaDatiFiscale.update({
        where: { id: proposta.id },
        data: {
          stato: 'rifiutata',
          notaStudio: (req.body?.notaStudio ?? '').trim() || null,
          gestitoDaId: req.user?.userId ?? null,
        },
      });
      await recordAudit({
        tenantId,
        userId: req.user?.userId ?? null,
        azione: 'DATO_FISCALE_RIFIUTATO',
        entita: proposta.id,
        dettagli: `Rifiutata modifica ${proposta.campo} per cliente ${proposta.clienteId}`,
      });

      // Punto 4 piano gap, riga 8 matrice — anche il rifiuto va comunicato, con la
      // motivazione se lo studio l'ha scritta: il cliente non deve restare in sospeso.
      // Qui il campo non ha passato il type-guard, quindi l'etichetta ricade sul nome tecnico.
      await notificaCliente(tenantId, proposta.clienteId, {
        tipoEvento: 'risposta_proposta_dati',
        oggetto: 'Proposta di modifica rifiutata',
        corpo: `Lo studio non ha accolto la modifica di ${(ETICHETTE_CAMPI_PROPONIBILI as Record<string, string>)[proposta.campo] ?? proposta.campo}.${rifiutata.notaStudio ? ` Motivazione: ${rifiutata.notaStudio}` : ''}`,
        link: '/portal/proposal',
      }).catch(() => {});

      return reply.send({ ok: true, proposta: rifiutata });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore rifiuto proposta' });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // §2.5 — ADDENDUM: il cliente scrive la richiesta, lo studio prepara.
  //
  // La cronologia addendum non vive più nel localStorage del cliente. Il cliente invia
  // una richiesta libera agganciata al progetto; lo studio la vede, la lavora e risponde
  // (motivazione del rifiuto oppure riferimento al documento predisposto).
  // ────────────────────────────────────────────────────────────────

  // Lato cliente: elenca le proprie richieste di addendum.
  server.get('/portal/addendum', async (req, reply) => {
    const tenantId = req.tenantId;
    const clienteId = clienteDellaRichiesta(req, (req.query as any)?.clienteId);
    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    try {
      const richieste = await prisma.richiestaAddendum.findMany({
        where: {
          tenantId,
          clienteId,
          ...((req.query as any)?.progettoId ? { progettoId: String((req.query as any).progettoId) } : {}),
        },
        include: { progetto: { select: { id: true, nome: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send({ ok: true, richieste });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura richieste addendum' });
    }
  });

  // Lato cliente: invia una richiesta di addendum su un progetto.
  server.post<{ Body: { progettoId?: string; testoRichiesta: string; clienteId?: string } }>('/portal/addendum', async (req, reply) => {
    const tenantId = req.tenantId;
    const clienteId = clienteDellaRichiesta(req, req.body?.clienteId);
    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });

    const { progettoId, testoRichiesta } = req.body || {};
    const testo = (testoRichiesta ?? '').trim();
    if (!testo) return reply.code(400).send({ errore: 'Descrivi la prestazione o il modulo che vuoi aggiungere.' });

    try {
      // Se il cliente non indica un progetto, usiamo il più recente dei suoi. Il progetto
      // deve comunque appartenere al cliente, altrimenti la richiesta finirebbe su un
      // incarico non suo.
      let progetto = progettoId
        ? await prisma.progetto.findFirst({ where: { id: String(progettoId), tenantId, clienteId }, select: { id: true, nome: true } })
        : await prisma.progetto.findFirst({ where: { tenantId, clienteId }, orderBy: { createdAt: 'desc' }, select: { id: true, nome: true } });
      if (!progetto) return reply.code(404).send({ errore: 'Nessun progetto su cui richiedere l\'addendum.' });

      // Il nome del cliente serve alla campanella dello studio (riga sotto): una notifica
      // che dicesse solo «cli-42» non parlerebbe a nessuno.
      const cliente = await prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
        select: { nome: true },
      });

      const richiesta = await prisma.richiestaAddendum.create({
        data: {
          tenantId,
          clienteId,
          progettoId: progetto.id,
          testoRichiesta: testo,
          stato: 'richiesta',
          richiestoDaId: req.user?.userId ?? null,
        },
        include: { progetto: { select: { id: true, nome: true } } },
      });

      await recordAudit({
        tenantId,
        userId: req.user?.userId ?? null,
        azione: 'RICHIESTA_ADDENDUM',
        entita: richiesta.id,
        dettagli: `Richiesta addendum del cliente ${clienteId} sul progetto ${progetto.id}`,
      });

      // Punto 4 piano gap (gap simmetrico cliente→studio) — la richiesta di addendum va
      // vista subito dallo studio: campanella con l'evento `messaggio_cliente` e link al
      // progetto, dove gli addendum si lavorano.
      await notificaStudio(tenantId, {
        tipoEvento: 'messaggio_cliente',
        oggetto: 'Richiesta di addendum',
        corpo: `${cliente?.nome ?? 'Il cliente'} ha chiesto un addendum su «${progetto.nome}»: ${testo.slice(0, 160)}`,
        link: `/projects/${progetto.id}`,
      }).catch(() => {});

      return reply.code(201).send({ ok: true, richiesta });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore invio richiesta addendum' });
    }
  });

  // Lato studio: elenca le richieste di addendum del tenant (filtrabili per progetto/stato).
  server.get('/addendum', async (req, reply) => {
    if (req.ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });
    const tenantId = req.tenantId || '00000000-0000-0000-0000-000000000001';
    const query = req.query as any;
    try {
      const richieste = await prisma.richiestaAddendum.findMany({
        where: {
          tenantId,
          ...(query.progettoId ? { progettoId: String(query.progettoId) } : {}),
          ...(query.stato ? { stato: String(query.stato) as any } : {}),
        },
        include: {
          cliente: { select: { id: true, nome: true } },
          progetto: { select: { id: true, nome: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send({ ok: true, richieste });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura richieste addendum' });
    }
  });

  // Lato studio: aggiorna lo stato di una richiesta (in lavorazione / pronta / rifiutata)
  // e allega la risposta per il cliente.
  server.post<{ Params: { id: string }; Body: { stato?: string; rispostaStudio?: string } }>('/addendum/:id/stato', async (req, reply) => {
    if (req.ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });
    const tenantId = req.tenantId || '00000000-0000-0000-0000-000000000001';
    const { id } = req.params;
    const STATI_ADDENDUM = ['richiesta', 'in_preparazione', 'pronta', 'rifiutata'];
    const nuovoStato = req.body?.stato;
    if (nuovoStato && !STATI_ADDENDUM.includes(nuovoStato)) {
      return reply.code(400).send({ errore: 'Stato non valido.' });
    }
    try {
      const richiesta = await prisma.richiestaAddendum.findFirst({ where: { id, tenantId } });
      if (!richiesta) return reply.code(404).send({ errore: 'Richiesta non trovata.' });
      const aggiornata = await prisma.richiestaAddendum.update({
        where: { id: richiesta.id },
        data: {
          ...(nuovoStato ? { stato: nuovoStato as any } : {}),
          ...(req.body?.rispostaStudio !== undefined ? { rispostaStudio: (req.body.rispostaStudio ?? '').trim() || null } : {}),
          gestitoDaId: req.user?.userId ?? null,
        },
        include: { cliente: { select: { id: true, nome: true } }, progetto: { select: { id: true, nome: true } } },
      });
      await recordAudit({
        tenantId,
        userId: req.user?.userId ?? null,
        azione: 'STATO_ADDENDUM',
        entita: richiesta.id,
        dettagli: `Stato addendum ${richiesta.id} -> ${nuovoStato ?? 'invariato'}`,
      });

      // Punto 4 piano gap, riga 7 matrice — il cliente va avvisato solo sugli esiti che lo
      // riguardano: 'pronta' (l'addendum è disponibile) e 'rifiutata' (con la risposta dello
      // studio, se scritta). 'in_preparazione' è lavorazione interna: notificarla sarebbe
      // rumore sulla campanella.
      if (aggiornata.stato === 'pronta' || aggiornata.stato === 'rifiutata') {
        await notificaCliente(tenantId, aggiornata.clienteId, {
          tipoEvento: 'risposta_addendum',
          oggetto: aggiornata.stato === 'pronta' ? 'Addendum pronto' : 'Richiesta di addendum rifiutata',
          corpo: aggiornata.stato === 'pronta'
            ? `La tua richiesta di addendum su «${aggiornata.progetto?.nome ?? 'il progetto'}» è pronta: la trovi nella sezione Proposta del portale.`
            : `La tua richiesta di addendum su «${aggiornata.progetto?.nome ?? 'il progetto'}» non è stata accolta.${aggiornata.rispostaStudio ? ` Risposta dello studio: ${aggiornata.rispostaStudio}` : ''}`,
          link: '/portal/proposal',
        }).catch(() => {});
      }

      return reply.send({ ok: true, richiesta: aggiornata });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore aggiornamento stato addendum' });
    }
  });
}
