// Il form dell'articolo dentro il progetto: quali form servono a una distinta, e la nascita di
// un passaggio — con le risposte che lo stesso cliente ha già dato a quel form, se ci sono.
// Le regole stanno in `domain/formArticolo.ts`; qui c'è solo ciò che legge e scrive.

import type { Prisma } from '@prisma/client';
import {
  campiDelForm,
  notaRisposteRiprese,
  risposteRiutilizzabili,
  type FormDellArticolo,
} from '../domain/formArticolo.js';
import type { PassaggioTemplateInput } from './istanziazionePort.js';

/** Il pezzo di Prisma che serve qui: vale per il client della richiesta e per una transazione. */
export interface ClientFormArticolo {
  formMaster: {
    findMany(args: { where: Prisma.FormMasterWhereInput }): Promise<Array<{ id: string; nome: string; campiJson: unknown }>>;
  };
  microvoceProgetto: {
    findFirst(args: {
      where: Prisma.MicrovoceProgettoWhereInput;
      select: { moduloProgetto: { select: { progetto: { select: { id: true; clienteId: true } } } } };
    }): Promise<{ moduloProgetto: { progetto: { id: string; clienteId: string } } } | null>;
  };
  passaggioProgetto: {
    findMany(args: {
      where: Prisma.PassaggioProgettoWhereInput;
      select: {
        risposteFormJson: true;
        microvoceProgetto: { select: { moduloProgetto: { select: { progetto: { select: { id: true; nome: true; createdAt: true } } } } } };
      };
    }): Promise<Array<{
      risposteFormJson: unknown;
      microvoceProgetto: { moduloProgetto: { progetto: { id: string; nome: string; createdAt: Date } } };
    }>>;
    create(args: { data: Prisma.PassaggioProgettoUncheckedCreateInput }): Promise<unknown>;
  };
}

/** I form (dello studio) nominati da un elenco di articoli, per id. Un id che non c'è più si salta. */
export async function formDegliArticoli(
  client: Pick<ClientFormArticolo, 'formMaster'>,
  tenantId: string,
  formMasterIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, FormDellArticolo>> {
  const ids = [...new Set(formMasterIds.filter((id): id is string => !!id))];
  const mappa = new Map<string, FormDellArticolo>();
  if (ids.length === 0) return mappa;
  const righe = await client.formMaster.findMany({ where: { tenantId, id: { in: ids } } });
  for (const r of righe) {
    const campi = campiDelForm(r.campiJson);
    // Un form senza domande non fa nascere un passaggio: non c'è niente da chiedere.
    if (campi.length > 0) mappa.set(r.id, { id: r.id, nome: r.nome, campi });
  }
  return mappa;
}

/**
 * Le risposte che il cliente dell'attività ha già dato a questo form in un suo progetto: le più
 * recenti (per data del progetto) fra quelle che hanno almeno una risposta alle domande di oggi.
 */
export async function risposteGiaDateDalCliente(
  client: Pick<ClientFormArticolo, 'microvoceProgetto' | 'passaggioProgetto'>,
  dove: { tenantId: string; microvoceProgettoId: string; formMasterId: string; campi: readonly string[] },
): Promise<{ risposte: Record<string, string>; progettoNome: string } | null> {
  const microvoce = await client.microvoceProgetto.findFirst({
    where: { id: dove.microvoceProgettoId, tenantId: dove.tenantId },
    select: { moduloProgetto: { select: { progetto: { select: { id: true, clienteId: true } } } } },
  });
  const clienteId = microvoce?.moduloProgetto.progetto.clienteId;
  if (!clienteId) return null;

  // Lo studio e il cliente stanno nella condizione: le risposte di un altro cliente, o di un
  // altro studio, non entrano mai in questo elenco.
  const precedenti = await client.passaggioProgetto.findMany({
    where: {
      tenantId: dove.tenantId,
      formMasterId: dove.formMasterId,
      microvoceProgetto: { moduloProgetto: { progetto: { tenantId: dove.tenantId, clienteId } } },
    },
    select: {
      risposteFormJson: true,
      microvoceProgetto: { select: { moduloProgetto: { select: { progetto: { select: { id: true, nome: true, createdAt: true } } } } } },
    },
  });

  const candidati = precedenti
    .map((p) => ({
      risposte: risposteRiutilizzabili(dove.campi, p.risposteFormJson),
      progetto: p.microvoceProgetto.moduloProgetto.progetto,
    }))
    .filter((c): c is { risposte: Record<string, string>; progetto: { id: string; nome: string; createdAt: Date } } => c.risposte !== null)
    .sort((a, b) => b.progetto.createdAt.getTime() - a.progetto.createdAt.getTime());

  const scelto = candidati[0];
  return scelto ? { risposte: scelto.risposte, progettoNome: scelto.progetto.nome } : null;
}

/**
 * Crea un passaggio del progetto dal suo modello. Se nasce da un form dell'articolo, si porta
 * dietro il form e le risposte già date dallo stesso cliente; resta comunque «da fare»: le
 * risposte riprese sono una proposta, il passaggio lo chiude una persona (regola 14).
 */
export async function creaPassaggioDaTemplate(
  client: Pick<ClientFormArticolo, 'microvoceProgetto' | 'passaggioProgetto'>,
  dove: { tenantId: string; microvoceProgettoId: string },
  passaggio: PassaggioTemplateInput,
): Promise<void> {
  const campi = campiDelForm(passaggio.campiFormJson);
  const riprese = passaggio.formMasterId
    ? await risposteGiaDateDalCliente(client, { ...dove, formMasterId: passaggio.formMasterId, campi })
    : null;

  await client.passaggioProgetto.create({
    data: {
      tenantId: dove.tenantId,
      microvoceProgettoId: dove.microvoceProgettoId,
      titolo: passaggio.titolo,
      tipo: passaggio.tipo,
      chi: passaggio.chi,
      ordine: passaggio.ordine,
      descrizione: riprese
        ? notaRisposteRiprese(riprese.progettoNome, Object.keys(riprese.risposte).length, campi.length)
        : passaggio.descrizione,
      campiFormJson: passaggio.campiFormJson as never,
      ...(passaggio.formMasterId && { formMasterId: passaggio.formMasterId }),
      ...(riprese && { risposteFormJson: riprese.risposte as Prisma.InputJsonValue }),
      stato: 'pending',
    },
  });
}
