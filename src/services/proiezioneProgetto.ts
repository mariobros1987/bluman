// Cosa esce dal server quando si legge un progetto (`GET /progetti`, `GET /progetti/:id`).
//
// Le due rotte restituivano le righe così come le dava il database: con `cliente: true` usciva
// l'impronta della password del cliente, e con `accessiRisorsa: { include: { user: true } }`
// uscivano impronta della password, segreto e codici di riserva del secondo fattore di ogni
// operatore con un accesso sulla pratica. Lo riceveva chiunque potesse leggere il progetto —
// anche il token del portale cliente.
//
// Qui si decide cosa esce: i segreti a nessuno; al cliente, in più, niente di ciò che è lavoro
// interno dello studio (valutazione AML, fatture in bozza, note degli operatori, chi ha accesso).

const SEGRETI_CLIENTE = ['passwordHash', 'password', 'sessionVersion'] as const;
const CAMPI_UTENTE = ['id', 'nome', 'email', 'ruolo', 'stato', 'specializzazione'] as const;

function senza<T extends Record<string, unknown>>(oggetto: T, chiavi: readonly string[]): T {
  const copia: Record<string, unknown> = { ...oggetto };
  for (const chiave of chiavi) delete copia[chiave];
  return copia as T;
}

function soloCampi(oggetto: Record<string, unknown>, chiavi: readonly string[]): Record<string, unknown> {
  const copia: Record<string, unknown> = {};
  for (const chiave of chiavi) if (chiave in oggetto) copia[chiave] = oggetto[chiave];
  return copia;
}

function oggetto(valore: unknown): valore is Record<string, unknown> {
  return Boolean(valore) && typeof valore === 'object' && !Array.isArray(valore);
}

/** Il progetto per chi lavora nello studio: tutto, tranne i segreti di accesso di clienti e operatori. */
export function progettoSenzaSegreti<T extends Record<string, any>>(progetto: T): T {
  const copia: Record<string, any> = { ...progetto };
  if (oggetto(copia.cliente)) copia.cliente = senza(copia.cliente, SEGRETI_CLIENTE);
  if (Array.isArray(copia.accessiRisorsa)) {
    copia.accessiRisorsa = copia.accessiRisorsa.map((accesso: any) =>
      oggetto(accesso) && oggetto(accesso.user) ? { ...accesso, user: soloCampi(accesso.user, CAMPI_UTENTE) } : accesso,
    );
  }
  return copia as T;
}

function passaggioPerCliente(passaggio: any): any {
  return oggetto(passaggio) ? senza(passaggio, ['noteOperatoreJson']) : passaggio;
}

function microvocePerCliente(microvoce: any): any {
  if (!oggetto(microvoce)) return microvoce;
  const copia: Record<string, any> = senza(microvoce, ['accessiRisorsa', 'risorsaId']);
  // Dell'operatore il cliente vede il nome (è quello che il portale mostra), non l'email né il ruolo.
  if (oggetto(copia.risorsa)) copia.risorsa = soloCampi(copia.risorsa, ['nome']);
  if (Array.isArray(copia.passaggi)) copia.passaggi = copia.passaggi.map(passaggioPerCliente);
  return copia;
}

/**
 * Il progetto come lo riceve il cliente dal portale. Stati, percentuali e struttura delle fasi
 * restano quelli calcolati dal server; escono i dati che riguardano lo studio e non lui.
 */
export function progettoPerCliente<T extends Record<string, any>>(progetto: T): T {
  const copia: Record<string, any> = senza(progetto, ['accessiRisorsa', 'fatture']);
  if (oggetto(copia.cliente)) copia.cliente = soloCampi(copia.cliente, ['id', 'nome', 'tipo']);
  if (Array.isArray(copia.moduli)) {
    copia.moduli = copia.moduli.map((modulo: any) => {
      if (!oggetto(modulo)) return modulo;
      const m: Record<string, any> = senza(modulo, ['accessiRisorsa']);
      if (Array.isArray(m.microvoci)) m.microvoci = m.microvoci.map(microvocePerCliente);
      if (Array.isArray(m.microvociCondivise)) {
        m.microvociCondivise = m.microvociCondivise.map((c: any) =>
          oggetto(c) && oggetto(c.microvoceProgetto) ? { ...c, microvoceProgetto: microvocePerCliente(c.microvoceProgetto) } : c,
        );
      }
      return m;
    });
  }
  return copia as T;
}

/** La proiezione giusta per il ruolo della richiesta. */
export function progettoPerRuolo<T extends Record<string, any>>(progetto: T, ruolo: string | undefined): T {
  return ruolo === 'cliente' ? progettoPerCliente(progetto) : progettoSenzaSegreti(progetto);
}
