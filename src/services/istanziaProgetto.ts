// Servizio di orchestrazione — §15.3: cosa succede internamente alla firma dell'engagement letter.
// Il passaggio più delicato di tutto il documento: scrive gran parte del grafo di entità in un
// colpo solo, dentro un'unica transazione atomica.

import type {
  IstanziazionePort,
  IstanziazioneTransazione,
  ModuloTemplateConDistinta,
  NotificationPort,
  StatoMicrovoceIniziale,
} from './istanziazionePort.js';

export interface RigaPreventivoAccettato {
  moduloTemplateId: string;
  moduloTemplateVersione: number; // pinnata al momento del preventivo, §15.2
}

export interface IstanziaProgettoInput {
  progettoId: string;
  clienteId: string;
  righe: RigaPreventivoAccettato[];
  /**
   * Se l'istanziazione nasce dall'accettazione di un preventivo, il suo id passa di qui:
   * il passaggio di stato a «accettato» avviene dentro la stessa transazione (§15.3),
   * così un rollback non lascia mai un preventivo accettato con i moduli mai istanziati.
   */
  preventivoId?: string;
}

export interface IstanziaProgettoRisultato {
  moduliProgettoIds: string[];
}

interface ModuloCreatoInfo {
  moduloTemplateId: string;
  moduloProgettoId: string;
  microvoceIds: string[];
  dipendenzeDa: string[]; // moduloTemplateId da cui dipende, secondo il template (§7ter)
}

function calcolaPrezzoModulo(template: ModuloTemplateConDistinta): number {
  if (template.prezzoPacchetto != null) return template.prezzoPacchetto;
  return template.righe.reduce((tot, r) => tot + r.prezzoEffettivo * r.quantita, 0);
}

function calcolaOreModulo(template: ModuloTemplateConDistinta): number {
  return template.righe.reduce((tot, r) => tot + r.oreEffettive * r.quantita, 0);
}

export { calcolaPrezzoModulo, calcolaOreModulo };


/**
 * §15.3 — I 6 passaggi, in ordine:
 *  1. Progetto pre_project → in_progress
 *  2. Per ogni riga del preventivo: crea modulo_progetto (versione template congelata)
 *  3. Per ogni riga di distinta: crea microvoce_progetto — una per unità di quantità (articolo congelato)
 *  4. Per ogni passaggio_template dell'articolo: crea passaggio_progetto per copia
 *  5. Per ogni dipendenza tra i moduli selezionati: crea modulo_progetto_dipendenza;
 *     i moduli con dipendenze non soddisfatte partono con microvoci in attesa_dipendenza
 *  6. Notifica cliente + team
 *
 * Se è fornito `preventivoId`, prima del passo 1 il preventivo viene segnato «accettato»
 * dentro la stessa transazione: un rollback non può quindi lasciare un preventivo accettato
 * con i moduli mai istanziati (il guasto che questa chiamata unica esiste per prevenire).
 *
 * Tutto dentro `port.eseguiInTransazione`: se un passaggio fallisce, rollback completo —
 * mai un progetto "a metà istanziato" (§15.3, ultima riga del documento).
 *
 * Semplificazione dichiarata: una dipendenza è considerata soddisfatta solo se il modulo
 * da cui si dipende fa parte di QUESTA stessa istanziazione. Il caso "dipendenza già
 * soddisfatta da un progetto precedente dello stesso cliente" (menzionato in §7ter come
 * avviso nel wizard) non è gestito da questa funzione: richiederebbe una query sullo
 * storico progetti del cliente, che è una responsabilità diversa da questa orchestrazione
 * pura. Se necessario, va risolta PRIMA di chiamare questa funzione (es. filtrando le
 * dipendenze già soddisfatte dall'input).
 */
export async function istanziaProgetto(
  input: IstanziaProgettoInput,
  port: IstanziazionePort,
  notifiche: NotificationPort,
): Promise<IstanziaProgettoRisultato> {
  if (input.righe.length === 0) {
    throw new Error('Impossibile istanziare un progetto senza moduli selezionati');
  }

  const risultato = await port.eseguiInTransazione(async (tx) => {
    // passo 0 — l'accettazione del preventivo, se è da lì che nasce questa istanziazione:
    // dentro la transazione, così un rollback la annulla insieme a tutto il resto.
    if (input.preventivoId && tx.marcaAccettatoPreventivo) {
      await tx.marcaAccettatoPreventivo(input.preventivoId);
    }

    // passo 1
    await tx.aggiornaStatoProgetto(input.progettoId, 'in_progress');

    const moduliCreati: ModuloCreatoInfo[] = [];

    // passi 2, 3, 4 — un modulo alla volta, per non tenere in memoria tutto il grafo insieme
    for (const riga of input.righe) {
      const template = await tx.getModuloTemplateConDistinta(riga.moduloTemplateId, riga.moduloTemplateVersione);

      const moduloProgettoId = await tx.creaModuloProgetto({
        progettoId: input.progettoId,
        moduloTemplateId: template.id,
        moduloTemplateVersione: template.versione,
        nome: template.nome,
        categoria: template.categoria,
        prezzo: calcolaPrezzoModulo(template),
        orePreventivate: calcolaOreModulo(template),
      });

      const microvoceIds: string[] = [];

      for (const rigaDistinta of template.righe) {
        for (let unita = 0; unita < rigaDistinta.quantita; unita++) {
          const microvoceId = await tx.creaMicrovoceProgetto({
            moduloProgettoId,
            articoloId: rigaDistinta.articoloId,
            articoloVersione: rigaDistinta.articoloVersione,
            rigaDistintaId: rigaDistinta.id,
            nome: rigaDistinta.articoloNome,
            orePreventivate: rigaDistinta.oreEffettive,
            stato: 'pending', // eventualmente corretto a attesa_dipendenza nel passo 5
            ordine: rigaDistinta.ordine,
          });
          microvoceIds.push(microvoceId);

          for (const passaggio of rigaDistinta.passaggi) {
            await tx.creaPassaggioProgetto({ microvoceProgettoId: microvoceId, ...passaggio });
          }
        }
      }

      moduliCreati.push({
        moduloTemplateId: riga.moduloTemplateId,
        moduloProgettoId,
        microvoceIds,
        dipendenzeDa: template.dipendenzeDa,
      });
    }

    // passo 5 — dipendenze tra i moduli appena creati
    const progettoIdByTemplateId = new Map(moduliCreati.map((m) => [m.moduloTemplateId, m.moduloProgettoId]));

    for (const modulo of moduliCreati) {
      if (modulo.dipendenzeDa.length === 0) continue;

      const dipendenzeNelBatch = modulo.dipendenzeDa
        .map((templateId) => progettoIdByTemplateId.get(templateId))
        .filter((id): id is string => id !== undefined);

      for (const dipendeDaId of dipendenzeNelBatch) {
        await tx.creaModuloProgettoDipendenza(modulo.moduloProgettoId, dipendeDaId);
      }

      // Se il modulo ha almeno una dipendenza soddisfatta all'interno di questo stesso
      // batch, nessuna di esse può essere già 'done' (sono state appena create): le sue
      // micro-voci partono quindi in attesa_dipendenza, non pending. Se le dipendenze
      // dichiarate dal template non sono state trovate nel batch (caso limite descritto
      // sopra), il modulo resta 'pending' — non blocchiamo per un caso che questa
      // funzione non ha gli elementi per risolvere correttamente.
      if (dipendenzeNelBatch.length > 0) {
        const nuovoStato: StatoMicrovoceIniziale = 'attesa_dipendenza';
        for (const microvoceId of modulo.microvoceIds) {
          await tx.impostaStatoMicrovoceIniziale(microvoceId, nuovoStato);
        }
      }
    }

    return { moduliProgettoIds: moduliCreati.map((m) => m.moduloProgettoId) };
  });

  // passo 6 — fuori dalla transazione: se la notifica fallisce non deve invalidare
  // un'istanziazione già andata a buon fine. Un fallimento qui va gestito con retry/coda,
  // non con un rollback dei dati già scritti.
  await notifiche.notificaProgettoAvviato({
    progettoId: input.progettoId,
    clienteId: input.clienteId,
    moduliProgettoIds: risultato.moduliProgettoIds,
  });

  return risultato;
}
