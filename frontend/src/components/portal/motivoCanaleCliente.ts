// Perché un canale per il codice di firma non è disponibile, detto al cliente.
// Il server spiega il motivo con le parole dello studio («non configurato nelle impostazioni
// dello studio: servono indirizzo del demone e numero»), che vanno bene a chi gestisce lo
// studio ma non a chi firma: qui si traduce, e l'informazione resta la stessa.
export function motivoCanaleCliente(motivo: string | undefined): string | undefined {
  if (!motivo) return motivo;
  if (motivo.includes('impostazioni dello studio')) return 'Non attivo per questo studio';
  if (motivo.startsWith('Nessun cellulare')) return 'Lo studio non ha il tuo cellulare';
  if (motivo.startsWith('Nessuna email')) return 'Lo studio non ha la tua email';
  if (motivo.startsWith('Nessun numero Signal')) return 'Lo studio non ha il tuo numero Signal';
  if (motivo.includes('forma internazionale')) return 'Il tuo numero Signal va scritto con il prefisso internazionale: chiedi allo studio di correggerlo';
  if (motivo.startsWith('Il cliente deve prima scrivere al bot')) return motivo.replace('Il cliente deve prima scrivere al bot', 'Per attivarlo scrivi prima al bot');
  return motivo;
}
