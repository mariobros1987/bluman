import type { Passaggio } from '../types';

/**
 * Un passaggio com'è a database, nella forma che la pagina del progetto sa disegnare.
 *
 * Il database enumera il tipo con i valori Prisma («documento», «verifica»); la pagina parla
 * «doc»/«check». La traduzione avviene qui, al confine, così il rendering (bottone allegato,
 * etichette, colori) riconosce la riga.
 */
export function passaggioDaDb(p: any): Passaggio {
  return {
    id: p.id,
    title: p.titolo,
    type: p.tipo === 'documento' ? 'doc' : p.tipo === 'verifica' ? 'check' : p.tipo,
    who: p.chi,
    stato: p.stato,
    desc: p.descrizione,
    file: p.documentoAllegatoUrl,
    fields: p.campiFormJson,
    // Le risposte raccolte: senza questa riga la scheda «Compila / Visualizza Form» riaprirebbe
    // vuota su dati che a database ci sono già.
    risposte: p.risposteFormJson ?? undefined,
    // Ciò che il cliente ha scritto dal portale: si legge soltanto, il salvataggio non lo rimanda.
    risposteCliente: p.risposteClienteJson ?? undefined,
    rispostaClienteAt: p.rispostaClienteAt ?? null,
  };
}
