// Accentratore delle mail — a quale cliente va un messaggio. Si guarda ciò che costa se è
// sbagliato: la posta di un cliente mostrata sotto un altro.
import { describe, it, expect } from 'vitest';
import { aliasIn, attribuisciMessaggio, indirizziIn, indirizzoDiInoltro, nuovoAliasPosta } from './services/postaAttribuzione.js';

const CLIENTI = [
  { id: 'c-rossi', email: 'mario.rossi@example.com', aliasPosta: 'k7m2p9xq' },
  { id: 'c-bianchi', email: 'Anna.Bianchi@example.com', aliasPosta: null },
  { id: 'c-verdi', email: null, aliasPosta: 'abcd2345' },
];

describe('attribuisciMessaggio', () => {
  it('l’alias nell’indirizzo di consegna decide, qualunque sia il mittente', () => {
    const esito = attribuisciMessaggio({
      intestazioni: { deliveredTo: 'raccolta+k7m2p9xq@studio.example', to: 'mario.rossi@example.com' },
      mittenteEmail: 'no-reply@banca.example',
      clienti: CLIENTI,
    });
    expect(esito).toEqual({ clienteId: 'c-rossi', attribuzione: 'automatica', criterio: 'alias', consegnatoA: 'Delivered-To: raccolta+k7m2p9xq@studio.example' });
  });

  it('l’alias vince sull’indirizzo: un messaggio per Bianchi inoltrato da Verdi è di Verdi', () => {
    const esito = attribuisciMessaggio({
      intestazioni: { xForwardedTo: 'Raccolta <RACCOLTA+ABCD2345@studio.example>', to: 'anna.bianchi@example.com' },
      mittenteEmail: 'fornitore@example.org',
      clienti: CLIENTI,
    });
    expect(esito.clienteId).toBe('c-verdi');
    expect(esito.criterio).toBe('alias');
  });

  it('un «+qualcosa» che non è un nostro alias non ferma la ricerca', () => {
    const esito = attribuisciMessaggio({
      intestazioni: { deliveredTo: 'raccolta+newsletter@studio.example', xOriginalTo: 'raccolta+k7m2p9xq@studio.example' },
      mittenteEmail: 'x@example.org',
      clienti: CLIENTI,
    });
    expect(esito.clienteId).toBe('c-rossi');
    expect(esito.consegnatoA).toBe('X-Original-To: raccolta+k7m2p9xq@studio.example');
  });

  it('senza alias, l’indirizzo del cliente fra i destinatari (inoltro automatico senza «+»)', () => {
    const esito = attribuisciMessaggio({
      intestazioni: { deliveredTo: 'raccolta@studio.example', to: 'Anna Bianchi <anna.bianchi@example.com>' },
      mittenteEmail: 'notaio@example.org',
      clienti: CLIENTI,
    });
    expect(esito).toMatchObject({ clienteId: 'c-bianchi', attribuzione: 'automatica', criterio: 'destinatario' });
  });

  it('senza alias né destinatario, il cliente che scrive dal suo indirizzo', () => {
    const esito = attribuisciMessaggio({
      intestazioni: { to: 'raccolta@studio.example' },
      mittenteEmail: 'MARIO.ROSSI@example.com',
      clienti: CLIENTI,
    });
    expect(esito).toMatchObject({ clienteId: 'c-rossi', criterio: 'mittente' });
  });

  it('un indirizzo che è di due clienti non decide: resta da smistare', () => {
    const esito = attribuisciMessaggio({
      intestazioni: { to: 'famiglia@example.com' },
      mittenteEmail: 'banca@example.org',
      clienti: [{ id: 'a', email: 'famiglia@example.com' }, { id: 'b', email: 'famiglia@example.com' }],
    });
    expect(esito).toEqual({ clienteId: null, attribuzione: 'da_smistare', criterio: null, consegnatoA: null });
  });

  it('nessun riscontro: da smistare, mai un cliente a caso', () => {
    const esito = attribuisciMessaggio({ intestazioni: { to: 'raccolta@studio.example' }, mittenteEmail: 'sconosciuto@example.org', clienti: CLIENTI });
    expect(esito.clienteId).toBeNull();
    expect(esito.attribuzione).toBe('da_smistare');
  });
});

describe('gli indirizzi', () => {
  it('legge gli indirizzi da un’intestazione con nomi e più destinatari', () => {
    expect(indirizziIn('"Rossi, Mario" <Mario.Rossi@Example.com>, altro@example.org; mario.rossi@example.com')).toEqual(['mario.rossi@example.com', 'altro@example.org']);
    expect(indirizziIn(null)).toEqual([]);
  });

  it('legge gli alias, e un «+» in fondo non è un alias', () => {
    expect(aliasIn('raccolta+k7m2p9xq@studio.example, altro@example.org')).toEqual(['k7m2p9xq']);
    expect(aliasIn('strano+@studio.example')).toEqual([]);
  });

  it('l’indirizzo di inoltro si compone solo se ci sono tutti i pezzi', () => {
    expect(indirizzoDiInoltro('Raccolta@Studio.example', 'k7m2p9xq')).toBe('raccolta+k7m2p9xq@studio.example');
    expect(indirizzoDiInoltro(null, 'k7m2p9xq')).toBeNull();
    expect(indirizzoDiInoltro('raccolta@studio.example', null)).toBeNull();
    expect(indirizzoDiInoltro('senza-chiocciola', 'k7m2p9xq')).toBeNull();
  });

  it('l’alias nuovo ha 8 caratteri, senza quelli che si confondono a voce', () => {
    let i = 0;
    const alias = nuovoAliasPosta((max) => (i++ * 7) % max);
    expect(alias).toMatch(/^[a-km-np-z2-9]{8}$/);
  });
});
