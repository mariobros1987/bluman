/**
 * Isolamento dei test dal database reale.
 *
 * `src/server.ts` istanzia `new PrismaClient()` a livello di modulo, e Prisma Client
 * carica `.env` da sé (non serve `dotenv.config()`): senza questo file la suite si
 * collegava al Supabase di produzione e ci scriveva dentro. È già accaduto — un
 * `vitest run` ha creato decine di clienti «Test», «Marco Ricci», «Solo nome» nel
 * database vero.
 *
 * `setupFiles` viene eseguito prima che i file di test importino i moduli applicativi,
 * quindi qui `process.env` viene fissato *prima* di `new PrismaClient()`. Prisma non
 * sovrascrive le variabili già presenti in `process.env` (semantica dotenv), quindi il
 * valore impostato qui vince su quello di `.env`.
 */

// URL sintatticamente valido ma irraggiungibile: la porta 1 rifiuta subito la
// connessione. Un URL malformato farebbe invece lanciare `new PrismaClient()` a tempo
// di import, rompendo l'intero file di test invece della singola query.
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/bluman_test?schema=public';
process.env.DIRECT_URL = process.env.DATABASE_URL;

// Segreto fisso e valido (≥32 caratteri): i token firmati restano verificabili dentro
// la stessa run e non compare l'avviso di segreto casuale a ogni file di test.
process.env.JWT_SECRET = 'segreto-di-test-non-usare-in-produzione-0123456789';

// Nessun invio reale di email o messaggi durante i test.
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.WA_TOKEN = '';

// I test non girano mai come produzione: qui `risolviSegreto()` (§23) deve poter
// accettare configurazioni di sviluppo senza terminare il processo.
process.env.NODE_ENV = 'test';
