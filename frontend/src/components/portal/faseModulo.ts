// Lo stato di un modulo come lo legge il cliente nel portale, dallo stato che il server ha
// calcolato (§16). Prima ogni modulo non concluso era «IN LAVORAZIONE (0%)», anche quello mai
// iniziato o fermo in attesa di un altro modulo.
//
// «In ritardo» e «bloccato» il cliente li vede come «in corso», com'era prima: se mostrargli il
// ritardo è una scelta dello studio (domanda per il titolare), non di questa etichetta.
export type FaseModulo = 'da_iniziare' | 'in_attesa' | 'in_corso' | 'completato';

export function faseModulo(statoServer: string | null | undefined): FaseModulo {
  switch (statoServer) {
    case 'done': case 'completed': case 'completato': return 'completato';
    case 'pending': return 'da_iniziare';
    case 'attesa_dipendenza': return 'in_attesa';
    default: return 'in_corso';
  }
}

export function etichettaFaseModulo(fase: FaseModulo | undefined, percentuale: number | undefined): string {
  switch (fase) {
    case 'da_iniziare': return 'Da iniziare';
    case 'in_attesa': return 'Inizia dopo un\'altra fase';
    case 'completato': return 'Completato';
    default: return `In corso (${percentuale ?? 0}%)`;
  }
}
