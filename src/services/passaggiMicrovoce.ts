// I passaggi interni di un'attività (la «Checklist Passaggi» della micro-voce): come si
// riconoscono e come si salvano.
//
// La pagina manda sempre l'elenco intero, e chiama i passaggi non ancora a database con un nome
// suo («s1», «p-1795…»). Finché il server creava una riga nuova per ogni nome che non era un id
// di database, ogni salvataggio li ricreava tutti: una spunta, quattro righe in più. Qui lo stesso
// nome sulla stessa attività porta sempre alla stessa riga, quindi salvare due volte è come
// salvare una volta.
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { livelloFirmaValido } from './livelloFirmaService.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * L'id di database di un passaggio. Un id già di database resta com'è; un nome dato dalla pagina
 * diventa un id ricavato da attività + nome, sempre lo stesso. Senza nome non c'è modo di
 * riconoscerlo: `undefined`, e la riga nasce con l'id che le dà il database.
 */
export function idPassaggio(microvoceId: string, idDallaPagina: unknown): string | undefined {
  if (typeof idDallaPagina !== 'string' || !idDallaPagina.trim()) return undefined;
  if (UUID.test(idDallaPagina)) return idDallaPagina.toLowerCase();
  const h = createHash('sha1').update(`passaggio:${microvoceId}:${idDallaPagina}`).digest('hex');
  // Forma di un UUID «da nome» (versione 5, variante RFC 4122).
  const variante = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variante}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** Il solo pezzo di Prisma che serve qui: così vale per il client della richiesta e per una transazione. */
export interface ClientPassaggi {
  passaggioProgetto: {
    upsert(args: {
      where: Prisma.PassaggioProgettoWhereUniqueInput;
      update: Prisma.PassaggioProgettoUncheckedUpdateInput;
      create: Prisma.PassaggioProgettoUncheckedCreateInput;
    }): Promise<unknown>;
    create(args: { data: Prisma.PassaggioProgettoUncheckedCreateInput }): Promise<unknown>;
  };
}

/**
 * Salva l'elenco dei passaggi di un'attività. Restituisce, in italiano, ciò che non si è salvato:
 * ogni passaggio si scrive per conto suo, e chi fallisce si dichiara senza fermare gli altri.
 */
export async function salvaPassaggiMicrovoce(
  client: ClientPassaggi,
  dove: { tenantId: string; microvoce: { id: string; nome: string } },
  proc: any[],
): Promise<string[]> {
  const nonSalvate: string[] = [];
  const { tenantId, microvoce } = dove;

  for (let pIdx = 0; pIdx < proc.length; pIdx++) {
    const p = proc[pIdx] ?? {};
    // Il tipo deve finire nell'enum `TipoPassaggio` (info|documento|form|verifica). La pagina
    // parla un vocabolario ridotto («doc», «check») e si traduce qui, al confine.
    const tipoGrezzo = String(p.type || p.tipo || '');
    const tipo: 'info' | 'documento' | 'form' | 'verifica' =
      tipoGrezzo === 'info' ? 'info'
      : tipoGrezzo === 'form' ? 'form'
      : tipoGrezzo === 'doc' || tipoGrezzo === 'documento' ? 'documento'
      : 'verifica';
    const chi: 'operatore' | 'cliente' = (p.who || p.chi) === 'cliente' ? 'cliente' : 'operatore';
    const titolo = p.title || p.titolo || `Passaggio ${pIdx + 1}`;
    // Piano firma §3.1 — il livello (ses|fea|feq) che il passaggio esige. Un valore non valido
    // si scarta: dati sporchi non devono sovrascrivere il livello che c'è.
    const livello = typeof p.livelloFirmaRichiesto === 'string' && livelloFirmaValido(p.livelloFirmaRichiesto)
      ? p.livelloFirmaRichiesto
      : undefined;
    // Campi e risposte del form: si accettano solo le forme che la pagina sa disegnare (elenco
    // di stringhe, oggetto di stringhe). Una colonna Json accetta qualunque cosa, e una forma
    // storta si scoprirebbe solo alla riapertura.
    const campiForm = Array.isArray(p.fields) && p.fields.every((f: unknown) => typeof f === 'string')
      ? (p.fields as string[])
      : undefined;
    const risposteForm = p.risposte && typeof p.risposte === 'object' && !Array.isArray(p.risposte)
      ? (p.risposte as Record<string, string>)
      : undefined;

    const comuni = {
      titolo,
      tipo,
      chi,
      stato: p.stato === 'done' ? 'done' : 'pending',
      ordine: pIdx,
      descrizione: p.desc || p.descrizione || null,
      documentoAllegatoUrl: p.documentoAllegatoUrl || p.file || null,
      richiedeFirmaCliente: Boolean(p.richiedeFirmaCliente),
    };
    const form = {
      ...(campiForm && { campiFormJson: campiForm as Prisma.InputJsonValue }),
      ...(risposteForm && { risposteFormJson: risposteForm as Prisma.InputJsonValue }),
    };
    const nuova = { tenantId, microvoceProgettoId: microvoce.id, ...comuni, livelloFirmaRichiesto: livello ?? 'ses', ...form };

    try {
      const id = idPassaggio(microvoce.id, p.id);
      if (id) {
        await client.passaggioProgetto.upsert({
          // L'attività sta nella condizione: l'id di un passaggio di un'altra attività non
          // trova la riga, e la creazione che segue si ferma sulla chiave già presa.
          where: { id, microvoceProgettoId: microvoce.id },
          // `undefined` in un aggiornamento vuol dire «non toccare»: un passaggio che non
          // porta campi, risposte o livello non azzera quelli che ha.
          update: { ...comuni, ...(livello && { livelloFirmaRichiesto: livello }), ...form },
          create: { id, ...nuova },
        });
      } else {
        await client.passaggioProgetto.create({ data: nuova });
      }
    } catch (errPassaggio) {
      console.warn(`Errore salvataggio passaggio «${titolo}» per micro-voce ${microvoce.id}:`, errPassaggio);
      nonSalvate.push(`micro-voce «${microvoce.nome}»: passaggio «${titolo}» non salvato`);
    }
  }
  return nonSalvate;
}
