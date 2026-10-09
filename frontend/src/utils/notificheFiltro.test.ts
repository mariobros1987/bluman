/**
 * Il filtro «senza fascicolo» della campanella (voce 9(c), 09/10/2026).
 *
 * La proprietà che conta non è «filtra bene»: è che filtri sul **tipo d'evento** e non sul tipo
 * visivo. `messaggio_non_instradabile` e l'euristica KYC condividono `type: 'blocked'`, quindi un
 * filtro scritto sul tipo visivo mostrerebbe anche i KYC — una cosa che con i fascicoli non
 * c'entra. Il primo test qui sotto è quello che tiene ferma la distinzione.
 */
import { describe, it, expect } from 'vitest';
import {
  EVENTO_SENZA_FASCICOLO,
  haNotificheSenzaFascicolo,
  nonLetteVisibili,
  notificheVisibili,
  type NotificaFiltrabile,
} from './notificheFiltro';

interface Notifica extends NotificaFiltrabile {
  id: string;
  read: boolean;
}

const nonInstradabile = (id: string, read = false): Notifica => ({
  id,
  read,
  tipoEvento: EVENTO_SENZA_FASCICOLO,
});

const altre = (id: string, tipoEvento?: string, read = false): Notifica => ({ id, read, tipoEvento });

describe('notificheVisibili', () => {
  it("con filtro «tutte» restituisce la lista intera, comprese le notifiche vecchie senza tipoEvento", () => {
    const lista = [nonInstradabile('a'), altre('b', 'firma_apposta'), altre('c')];
    expect(notificheVisibili(lista, 'tutte').map(n => n.id)).toEqual(['a', 'b', 'c']);
  });

  it("con filtro «senza fascicolo» tiene solo gli avvisi di messaggio non archiviato", () => {
    const lista = [nonInstradabile('a'), altre('b', 'firma_apposta'), nonInstradabile('c')];
    expect(notificheVisibili(lista, 'senza_fascicolo').map(n => n.id)).toEqual(['a', 'c']);
  });

  it("un KYC bloccato ha lo stesso tipo VISIVO ma non è «senza fascicolo», e non entra", () => {
    // Il KYC non porta `tipoEvento` (nasce dall'euristica sull'oggetto) — ed è proprio il caso
    // in cui un filtro su `type === 'blocked'` sbaglierebbe.
    const lista = [nonInstradabile('msg'), altre('kyc')];
    const filtrate = notificheVisibili(lista, 'senza_fascicolo');
    expect(filtrate.map(n => n.id)).toEqual(['msg']);
    expect(filtrate.some(n => n.id === 'kyc')).toBe(false);
  });

  it("il tipo d'evento si confronta per uguaglianza esatta, non per somiglianza", () => {
    // Una notifica il cui tipo *contiene* la stringa non è la stessa cosa: un futuro
    // `messaggio_non_instradabile_risolto` non deve finire nel filtro di quelli ancora aperti.
    const lista = [altre('x', `${EVENTO_SENZA_FASCICOLO}_risolto`), nonInstradabile('y')];
    expect(notificheVisibili(lista, 'senza_fascicolo').map(n => n.id)).toEqual(['y']);
  });

  it('non muta la lista ricevuta', () => {
    const lista = [nonInstradabile('a'), altre('b', 'firma_apposta')];
    const copia = [...lista];
    notificheVisibili(lista, 'senza_fascicolo');
    expect(lista).toEqual(copia);
  });
});

describe('haNotificheSenzaFascicolo', () => {
  it('è falso quando nessun canale ha mai scartato un messaggio: il filtro non compare', () => {
    // Un comando che filtra verso il vuoto è peggio di un comando assente: l'operatore lo preme,
    // vede una lista vuota e non sa se è un guasto o se non c'è niente.
    expect(haNotificheSenzaFascicolo([altre('a', 'firma_apposta'), altre('b')])).toBe(false);
    expect(haNotificheSenzaFascicolo([])).toBe(false);
  });

  it('è vero appena ce n\'è uno, anche se è già letto', () => {
    // Letto non vuol dire risolto: l'avviso resta in lista, e resta da filtrare.
    expect(haNotificheSenzaFascicolo([altre('a'), nonInstradabile('b', true)])).toBe(true);
  });
});

describe('nonLetteVisibili', () => {
  it('conta le non lette dentro il filtro attivo, non in tutta la lista', () => {
    const lista = [nonInstradabile('a'), nonInstradabile('b', true), altre('c', 'firma_apposta')];
    // «1 nuove» accanto a un elenco di due voci sarebbe una contraddizione a vista.
    expect(nonLetteVisibili(lista, 'senza_fascicolo')).toBe(1);
    expect(nonLetteVisibili(lista, 'tutte')).toBe(2);
  });
});
