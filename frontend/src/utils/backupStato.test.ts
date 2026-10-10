// Voce 8-bis — la freschezza della copia di sicurezza, ai confini.
//
// È la parte che si sbaglia più facilmente e che si nota meno: un `null` trasformato in
// «adesso», una soglia confrontata col segno sbagliato, un'età presa per buona quando è stata
// misurata mezza giornata prima. Ognuno di questi errori produce la stessa cosa — una copia
// vecchia che si presenta come fresca — ed è esattamente il guasto silenzioso da cui la voce
// esiste per difendersi. Perciò i confini si verificano qui, senza montare React.
import { describe, it, expect } from 'vitest';
import {
  etaCopiaOre,
  formattaFreschezza,
  formattaOre,
  livelloFreschezza,
  sintesiCopia,
  type EsitoBackupFile,
  type EsitoVerificaFile,
  type StatoCopia,
} from './backupStato';

/** Un istante fisso: usare `Date.now()` renderebbe i confini mobili e i test intermittenti. */
const ADESSO = Date.parse('2026-10-10T12:00:00.000Z');
const MINUTO = 60_000;
const ORA = 60 * MINUTO;
const GIORNO = 24 * ORA;

const fa = (ms: number) => new Date(ADESSO - ms).toISOString();

describe('formattaFreschezza', () => {
  it('una data mancante resta `null`, non diventa «adesso»', () => {
    // È la regola del modulo. Un istante mancante reso come «adesso» fa sembrare fatto ora un
    // backup di due settimane fa.
    expect(formattaFreschezza(null, ADESSO)).toBeNull();
    expect(formattaFreschezza(undefined, ADESSO)).toBeNull();
    expect(formattaFreschezza('', ADESSO)).toBeNull();
    expect(formattaFreschezza('non-una-data', ADESSO)).toBeNull();
  });

  it('sotto il minuto dice «adesso»', () => {
    expect(formattaFreschezza(fa(0), ADESSO)).toBe('adesso');
    expect(formattaFreschezza(fa(30_000), ADESSO)).toBe('adesso');
    // Il confine esatto: a 60 secondi si passa ai minuti.
    expect(formattaFreschezza(fa(59_999), ADESSO)).toBe('adesso');
    expect(formattaFreschezza(fa(MINUTO), ADESSO)).toBe('1 minuto fa');
  });

  it('un orologio sfasato non produce «-2 ore fa»', () => {
    // Una data nel futuro è un orologio da sistemare, non un backup appena fatto.
    expect(formattaFreschezza(new Date(ADESSO + 2 * ORA).toISOString(), ADESSO)).toBe('adesso');
  });

  it('minuti, ore e giorni al singolare e al plurale', () => {
    expect(formattaFreschezza(fa(5 * MINUTO), ADESSO)).toBe('5 minuti fa');
    expect(formattaFreschezza(fa(59 * MINUTO), ADESSO)).toBe('59 minuti fa');
    expect(formattaFreschezza(fa(ORA), ADESSO)).toBe('1 ora fa');
    expect(formattaFreschezza(fa(3 * ORA), ADESSO)).toBe('3 ore fa');
    expect(formattaFreschezza(fa(23 * ORA), ADESSO)).toBe('23 ore fa');
  });

  it('oltre il giorno dice «ieri», poi i giorni, poi la data', () => {
    expect(formattaFreschezza(fa(24 * ORA), ADESSO)).toBe('ieri');
    expect(formattaFreschezza(fa(47 * ORA), ADESSO)).toBe('ieri');
    expect(formattaFreschezza(fa(2 * GIORNO), ADESSO)).toBe('2 giorni fa');
    expect(formattaFreschezza(fa(29 * GIORNO), ADESSO)).toBe('29 giorni fa');
    // Oltre il mese una data esatta è più utile di «47 giorni fa».
    expect(formattaFreschezza(fa(40 * GIORNO), ADESSO)).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});

describe('formattaOre', () => {
  it('`null` e valori non finiti restano `null`', () => {
    expect(formattaOre(null)).toBeNull();
    expect(formattaOre(undefined)).toBeNull();
    expect(formattaOre(Number.NaN)).toBeNull();
  });

  it('sotto l’ora lo dice senza arrotondare a zero', () => {
    expect(formattaOre(0.5)).toBe('meno di un’ora fa');
    expect(formattaOre(0)).toBe('meno di un’ora fa');
  });

  it('ore e giorni, al singolare e al plurale', () => {
    expect(formattaOre(1)).toBe('1 ora fa');
    expect(formattaOre(3.9)).toBe('3 ore fa');
    expect(formattaOre(23.9)).toBe('23 ore fa');
    expect(formattaOre(24)).toBe('ieri');
    expect(formattaOre(48)).toBe('2 giorni fa');
  });
});

describe('livelloFreschezza', () => {
  it('senza un numero di ore il livello è «sconosciuto», non «ok»', () => {
    expect(livelloFreschezza(null)).toBe('sconosciuto');
    expect(livelloFreschezza(undefined)).toBe('sconosciuto');
    expect(livelloFreschezza(Number.NaN)).toBe('sconosciuto');
  });

  it('la metà della soglia è l’avviso che precede il problema', () => {
    // Fra metà soglia e la soglia si dice «attenzione»: serve a vedere arrivare il problema una
    // notte prima, invece di accorgersene quando è già passato.
    expect(livelloFreschezza(0)).toBe('ok');
    expect(livelloFreschezza(15)).toBe('ok');
    expect(livelloFreschezza(15.1)).toBe('attenzione');
    expect(livelloFreschezza(30)).toBe('attenzione');
    expect(livelloFreschezza(30.1)).toBe('vecchia');
  });

  it('la soglia è quella che si passa, non una cablata', () => {
    expect(livelloFreschezza(10, 8)).toBe('vecchia');
    expect(livelloFreschezza(10, 48)).toBe('ok');
  });
});

describe('etaCopiaOre', () => {
  const verifica = (ore: number | null, quando: string | null): EsitoVerificaFile => ({
    stato: 'ok', quando, ore, file: null, dettaglio: '',
  });

  it('somma il tempo passato da quando la misura è stata presa', () => {
    // `verifica.ore` è l'età misurata dal monitor, che può aver guardato il remoto mezza
    // giornata fa: prenderla per buona farebbe sembrare fresca una copia invecchiata.
    expect(etaCopiaOre(verifica(3, fa(2 * ORA)), ADESSO)).toBeCloseTo(5, 5);
  });

  it('senza una misura o senza la data, non si inventa un’età', () => {
    expect(etaCopiaOre(verifica(null, fa(ORA)), ADESSO)).toBeNull();
    expect(etaCopiaOre(verifica(3, null), ADESSO)).toBeNull();
    expect(etaCopiaOre(verifica(3, 'non-una-data'), ADESSO)).toBeNull();
  });

  it('una verifica datata nel futuro non produce un’età negativa', () => {
    // Di nuovo l'orologio sfasato: un'età negativa verrebbe formattata come «meno di un'ora fa»,
    // cioè il contrario della verità.
    expect(etaCopiaOre(verifica(3, new Date(ADESSO + ORA).toISOString()), ADESSO)).toBe(3);
  });
});

describe('sintesiCopia', () => {
  const backup = (p: Partial<EsitoBackupFile> = {}): EsitoBackupFile => ({
    esito: 'ok',
    quando: fa(3 * ORA),
    file: 'bluman-2026-10-10.sql.gz.enc',
    byte: 1024,
    copiaOffSite: 'ok',
    dettaglio: 'backup completato',
    ...p,
  });
  const verifica = (p: Partial<EsitoVerificaFile> = {}): EsitoVerificaFile => ({
    stato: 'ok',
    quando: fa(ORA),
    ore: 4,
    file: 'bluman-2026-10-10.sql.gz.enc',
    dettaglio: 'la copia più recente sul remoto ha 4 ore',
    ...p,
  });
  const stato = (p: Partial<StatoCopia> = {}): StatoCopia => ({
    disponibile: true,
    copiaConfigurata: true,
    backup: backup(),
    verifica: verifica(),
    ...p,
  });

  it('un backend che non fa i backup lo dice, invece di mostrare uno stato vuoto', () => {
    const s = sintesiCopia(stato({ disponibile: false }));
    expect(s.livello).toBe('sconosciuto');
    expect(s.titolo).toMatch(/non verificabile da qui/i);
    expect(s.dettaglio).toMatch(/server di produzione/i);
  });

  it('il verdetto del monitor batte tutto il resto: è la copia che sopravvive al server', () => {
    const s = sintesiCopia(stato({
      verifica: verifica({ stato: 'fail', ore: 40, dettaglio: 'la copia più recente sul remoto ha 40 ore' }),
      // Anche con il backup locale dichiarato riuscito: è il caso che sembra a posto e non lo è.
      backup: backup({ esito: 'ok', copiaOffSite: 'ok' }),
    }));
    expect(s.livello).toBe('errore');
    expect(s.titolo).toMatch(/fuori dal server non è aggiornata/i);
    expect(s.dettaglio).toMatch(/40 ore/);
  });

  it('un backup locale fallito è un errore, non «non ancora verificato»', () => {
    // L'ordine dei casi è l'ordine di gravità: se il primo che vale non vincesse, un guasto
    // verrebbe descritto come un'attesa.
    const s = sintesiCopia(stato({
      backup: backup({ esito: 'fallito', dettaglio: 'il dump non è stato completato' }),
      verifica: verifica({ stato: 'unknown', ore: null, dettaglio: 'non ancora verificato' }),
    }));
    expect(s.livello).toBe('errore');
    expect(s.titolo).toMatch(/backup notturno è fallito/i);
    expect(s.dettaglio).toMatch(/dump/);
  });

  it('il backup riuscito che non è uscito dal server è il caso peggiore da non vedere', () => {
    const s = sintesiCopia(stato({
      backup: backup({ esito: 'ok', copiaOffSite: 'fallita', dettaglio: 'rclone non ha copiato 3 artefatti su 3' }),
    }));
    expect(s.livello).toBe('errore');
    expect(s.titolo).toMatch(/non è uscito dal server/i);
  });

  it('una copia non configurata è un’attenzione, non un errore: è una cosa che manca', () => {
    const s = sintesiCopia(stato({
      copiaConfigurata: false,
      verifica: verifica({ stato: 'unknown', ore: null }),
    }));
    expect(s.livello).toBe('attenzione');
    expect(s.titolo).toMatch(/non configurata/i);
    expect(s.dettaglio).toMatch(/super admin/);
  });

  it('configurata ma non ancora verificata: attenzione, col motivo del monitor', () => {
    const s = sintesiCopia(stato({
      verifica: verifica({ stato: 'unknown', ore: null, dettaglio: 'rclone non è installato' }),
    }));
    expect(s.livello).toBe('attenzione');
    expect(s.dettaglio).toMatch(/rclone non è installato/);
  });

  it('tutto a posto: dice da quanto, con l’età ricalcolata adesso', () => {
    const s = sintesiCopia(stato({ verifica: verifica({ ore: 4, quando: fa(2 * ORA) }) }), ADESSO);
    expect(s.livello).toBe('ok');
    expect(s.titolo).toBe('Copia di sicurezza: ultima copia 6 ore fa');
  });

  it('quando l’età non è calcolabile ricade sulla data del backup, non su «verificata» e basta', () => {
    const s = sintesiCopia(stato({ verifica: verifica({ ore: null, quando: null }) }), ADESSO);
    expect(s.livello).toBe('ok');
    expect(s.titolo).toBe('Copia di sicurezza: ultima copia 3 ore fa');
  });

  it('senza nessuna data utile resta una frase vera: «verificata»', () => {
    const s = sintesiCopia(stato({
      verifica: verifica({ ore: null, quando: null, dettaglio: '' }),
      backup: backup({ quando: null, dettaglio: '' }),
    }), ADESSO);
    expect(s.livello).toBe('ok');
    expect(s.titolo).toBe('Copia di sicurezza: verificata');
  });
});
