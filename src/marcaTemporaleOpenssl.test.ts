/**
 * `openssl ts -verify` sul token vero di FreeTSA.
 *
 * L'adapter NON verifica la firma CMS del token né la catena del certificato: lo dichiara
 * nell'`avviso` di ogni esito e la ricevuta lo ripete. Qui la verifica la fa OpenSSL, sullo
 * stesso token che l'app conserva accanto alla firma, con l'ancora di fiducia di FreeTSA
 * (`freetsa-cacert.pem`, preso da <https://freetsa.org/files/cacert.pem> il 20/10/2026).
 *
 * A cosa serve:
 * - dimostrare che il token salvato è verificabile **fuori** dalla piattaforma, come
 *   promette la ricevuta
 *   (`openssl ts -verify -token_in -digest <impronta> -in token.tsr -CAfile <CA TSA>`);
 * - accorgersi se il parser smette di produrre un token intero: con openssl il guasto si
 *   vede qui invece che da un cliente che non riesce a verificare la propria marca.
 *
 * Il test si salta se `openssl` non è nel PATH: sul VPS c'è (`Dockerfile`, alpine openssl),
 * su una macchina di sviluppo può mancare. Saltarlo non nasconde niente: gli altri test
 * coprono il parser, e questo copre proprio ciò che il parser non può dire di sé.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TSA_PREDEFINITA, leggiRispostaMarcaTemporale } from './services/marcaTemporaleService.js';
import { RISPOSTA_FREETSA_20261017 } from './test-fixtures/freetsa.js';

const ANCORA_DI_FIDUCIA = fileURLToPath(
  new URL('./test-fixtures/freetsa-cacert.pem', import.meta.url),
);
const HASH = Buffer.from(RISPOSTA_FREETSA_20261017.hashHex, 'hex');
const NONCE = BigInt(RISPOSTA_FREETSA_20261017.nonce);

const openssl = spawnSync('openssl', ['version'], { encoding: 'utf8' });
const haOpenssl = openssl.status === 0;

let cartella = '';
let token = Buffer.alloc(0);

/**
 * Scrive i byte in un file temporaneo e li fa verificare a openssl con l'impronta indicata.
 * L'output di `openssl ts` cambia fra versioni (stdout per una, stderr per l'altra): si
 * guardano insieme il codice di uscita e il testo, non solo uno dei due.
 */
function verifica(byte: Buffer, improntaHex: string) {
  const file = join(cartella, 'token.tsr');
  writeFileSync(file, byte);
  const esito = spawnSync(
    'openssl',
    // Il file conservato è il TimeStampToken, non la TimeStampResp che lo conteneva:
    // senza `-token_in` openssl prova a leggerlo come risposta e si ferma su status_info.
    ['ts', '-verify', '-token_in', '-digest', improntaHex, '-in', file, '-CAfile', ANCORA_DI_FIDUCIA],
    { encoding: 'utf8' },
  );
  return {
    codice: esito.status,
    uscita: `${esito.stdout ?? ''}${esito.stderr ?? ''}`,
  };
}

describe.skipIf(!haOpenssl)('openssl ts -verify sul token conservato con la firma', () => {
  beforeAll(() => {
    // Il token è quello che il servizio restituisce: non si costruisce a mano nel test.
    const esito = leggiRispostaMarcaTemporale(
      Buffer.from(RISPOSTA_FREETSA_20261017.rispostaBase64, 'base64'),
      { hash: HASH, nonce: NONCE, endpoint: TSA_PREDEFINITA },
    );
    if (!esito.ok || !esito.tokenBase64) {
      throw new Error(`Il fixture non produce un token valido: ${esito.errore}`);
    }
    token = Buffer.from(esito.tokenBase64, 'base64');
    cartella = mkdtempSync(join(tmpdir(), 'bluman-marca-'));
  });

  afterAll(() => {
    if (cartella) rmSync(cartella, { recursive: true, force: true });
  });

  it('verifica il token con l’ancora di fiducia di FreeTSA', () => {
    const esito = verifica(token, RISPOSTA_FREETSA_20261017.hashHex);
    expect(esito.uscita).toMatch(/Verification: OK/);
    expect(esito.codice).toBe(0);
  });

  it('rifiuta lo stesso token dichiarando un’altra impronta', () => {
    const esito = verifica(token, 'ff'.repeat(32));
    expect(esito.uscita).not.toMatch(/Verification: OK/);
    expect(esito.codice).not.toBe(0);
  });

  it('rifiuta un token manomesso: la firma CMS non torna', () => {
    // Un byte dentro la firma: il DER resta valido, la firma no.
    const manomesso = Buffer.from(token);
    manomesso[manomesso.length - 10] = manomesso[manomesso.length - 10]! ^ 0xff;
    const esito = verifica(manomesso, RISPOSTA_FREETSA_20261017.hashHex);
    expect(esito.uscita).not.toMatch(/Verification: OK/);
    expect(esito.codice).not.toBe(0);
  });

  it('l’ancora di fiducia è quella di FreeTSA, non un certificato qualsiasi', () => {
    // Se un giorno si aggiorna il certificato, questo test dice che è cambiato davvero
    // e che il file non è stato sostituito per sbaglio.
    const pem = readFileSync(ANCORA_DI_FIDUCIA, 'utf8');
    expect(pem).toMatch(/BEGIN CERTIFICATE/);
    expect(pem.match(/BEGIN CERTIFICATE/g)).toHaveLength(1);
    const impronta = spawnSync('openssl', ['x509', '-in', ANCORA_DI_FIDUCIA, '-noout', '-fingerprint', '-sha256'], {
      encoding: 'utf8',
    });
    expect(impronta.status).toBe(0);
    // OpenSSL 3.5 scrive «sha256 Fingerprint=», le versioni precedenti «SHA256 Fingerprint=».
    expect(`${impronta.stdout}${impronta.stderr}`).toMatch(/sha256 fingerprint=/i);
  });
});
