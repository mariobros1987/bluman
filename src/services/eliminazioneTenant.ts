// Eliminazione definitiva di un tenant e di tutti i suoi dati (§21, opzione B).
//
// Perché in transazione esplicita e non con `ON DELETE CASCADE`: nessuna delle relazioni
// verso `Tenant` dichiara il cascade, e aggiungerlo a 24+ relazioni sarebbe una migrazione
// ampia e altrettanto distruttiva. Qui cancelliamo i figli in ordine di dipendenza dentro
// un'unica transazione: o sparisce tutto, o niente.
//
// Connessione: `prismaAmministrativo()` (ruolo owner, bypassrls). Serve perché la RLS è in
// modalità FORCE e il super_admin opera dal tenant di default: una cancellazione riga-per-riga
// vincolata al tenant target verrebbe filtrata. L'owner vede e cancella tutto — ed è per
// questo che questa funzione NON è raggiungibile senza passare dal guard super_admin del
// chiamante.
//
// Ordine calcolato dalle foreign key dello schema (figli prima dei genitori). Le relazioni
// `onDelete: Cascade` si risolvono da sole quando si cancella il genitore, quindi una
// `deleteMany` su una tabella già svuotata da un cascade è un no-op innocuo. Le relazioni
// `Restrict`/senza `onDelete` sono quelle che impongono l'ordine.

import { prismaAmministrativo } from '../util/prismaClient.js';

/**
 * Cancella tutti i dati del tenant e infine la riga `tenant`. Ritorna il conteggio grezzo
 * delle righe eliminate per tabella (utile per l'audit e per un riscontro all'operatore).
 *
 * ⚠️ Irreversibile. Il chiamante DEVE aver verificato che il tenant sia in stato 'archiviato'
 * e che chi invoca sia super_admin.
 */
export async function eliminaTenantCompleto(tenantId: string): Promise<Record<string, number>> {
  const prisma = prismaAmministrativo();
  const conteggi: Record<string, number> = {};

  await prisma.$transaction(async (tx) => {
    const w = { where: { tenantId } } as const;

    // Il ciclo Documento↔User e l'auto-riferimento di Documento (versioni) si rompono
    // azzerando prima le FK nullable, così le deleteMany successive non trovano vincoli
    // Restrict interni alla stessa tabella o verso User.
    await tx.documento.updateMany({
      where: { tenantId },
      data: { documentoPadreId: null, archiviatoDaId: null, caricatoDa: null },
    });

    // Ordine figli → genitori. I cascade (Fattura→righe/incassi, ecc.) sono coperti.
    const passi: Array<[string, () => Promise<{ count: number }>]> = [
      ['accessoRisorsa', () => tx.accessoRisorsa.deleteMany(w)],
      ['auditLog', () => tx.auditLog.deleteMany(w)],
      ['auditLogFattura', () => tx.auditLogFattura.deleteMany(w)],
      ['checklistVoce', () => tx.checklistVoce.deleteMany(w)],
      ['collegamentoChatProgetto', () => tx.collegamentoChatProgetto.deleteMany(w)],
      ['comunicazioneProgetto', () => tx.comunicazioneProgetto.deleteMany(w)],
      ['notifica', () => tx.notifica.deleteMany(w)],
      ['oraTimesheet', () => tx.oraTimesheet.deleteMany(w)],
      ['eventoCalendario', () => tx.eventoCalendario.deleteMany(w)],
      ['movimentoPrimaNota', () => tx.movimentoPrimaNota.deleteMany(w)],
      ['registrazioneIncasso', () => tx.registrazioneIncasso.deleteMany(w)],
      ['scadenzaIncasso', () => tx.scadenzaIncasso.deleteMany(w)],
      ['fatturaRiga', () => tx.fatturaRiga.deleteMany(w)],
      ['fattura', () => tx.fattura.deleteMany(w)],
      ['liquidazioneIva', () => tx.liquidazioneIva.deleteMany(w)],
      ['fatturaRicevuta', () => tx.fatturaRicevuta.deleteMany(w)],
      ['fornitore', () => tx.fornitore.deleteMany(w)],
      ['contoBancario', () => tx.contoBancario.deleteMany(w)],
      ['contrattoRicorrente', () => tx.contrattoRicorrente.deleteMany(w)],
      ['propostaDatiFiscale', () => tx.propostaDatiFiscale.deleteMany(w)],
      ['richiestaAddendum', () => tx.richiestaAddendum.deleteMany(w)],
      ['richiestaModificaDocumento', () => tx.richiestaModificaDocumento.deleteMany(w)],
      ['firmaElettronica', () => tx.firmaElettronica.deleteMany(w)],
      ['passaggioProgetto', () => tx.passaggioProgetto.deleteMany(w)],
      ['documento', () => tx.documento.deleteMany(w)],
      ['modelloDocumentoCustom', () => tx.modelloDocumentoCustom.deleteMany(w)],
      ['modelloDocumentoInBianco', () => tx.modelloDocumentoInBianco.deleteMany(w)],
      ['formMaster', () => tx.formMaster.deleteMany(w)],
      ['engagementLetter', () => tx.engagementLetter.deleteMany(w)],
      ['preventivo', () => tx.preventivo.deleteMany(w)],
      ['permessoModulo', () => tx.permessoModulo.deleteMany(w)],
      ['magicLink', () => tx.magicLink.deleteMany(w)],
      ['codiceOtp', () => tx.codiceOtp.deleteMany(w)],
      ['webhookInbox', () => tx.webhookInbox.deleteMany(w)],
      ['credenzialeServizioEsterno', () => tx.credenzialeServizioEsterno.deleteMany(w)],
      // Gerarchia progetto: micro-voci → moduli → progetti (Restrict tra loro).
      ['microvoceProgetto', () => tx.microvoceProgetto.deleteMany(w)],
      ['moduloProgettoDipendenza', () => tx.moduloProgettoDipendenza.deleteMany(w)],
      ['moduloProgetto', () => tx.moduloProgetto.deleteMany(w)],
      ['progetto', () => tx.progetto.deleteMany(w)],
      ['cliente', () => tx.cliente.deleteMany(w)],
      // Catalogo: righe distinta → moduli/articoli template → giurisdizioni.
      ['rigaDistinta', () => tx.rigaDistinta.deleteMany(w)],
      ['moduloDipendenzaTemplate', () => tx.moduloDipendenzaTemplate.deleteMany(w)],
      ['articolo', () => tx.articolo.deleteMany(w)],
      ['moduloTemplate', () => tx.moduloTemplate.deleteMany(w)],
      ['giurisdizione', () => tx.giurisdizione.deleteMany(w)],
      // Gli utenti dello studio per ultimi: molte tabelle sopra li referenziano.
      ['user', () => tx.user.deleteMany(w)],
    ];

    for (const [nome, azione] of passi) {
      const { count } = await azione();
      conteggi[nome] = count;
    }

    // Infine la riga tenant. `delete` (non deleteMany) così un id inesistente qui fa fallire
    // l'intera transazione invece di passare in silenzio.
    await tx.tenant.delete({ where: { id: tenantId } });
    conteggi.tenant = 1;
  });

  return conteggi;
}
