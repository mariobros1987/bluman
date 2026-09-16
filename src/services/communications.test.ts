import { describe, it, expect, beforeEach } from 'vitest';
import { buildServer } from '../server.js';
import { InMemoryApp } from '../adapters/inMemoryApp.js';

function validaConfigurazioneSmtp(config: { host?: string; port?: number; user?: string; pass?: string }) {
  if (!config.host || config.host.trim() === '') return { valido: false, errore: 'Host SMTP mancante' };
  if (!config.port || config.port <= 0) return { valido: false, errore: 'Porta SMTP non valida' };
  if (!config.user || !config.user.includes('@')) return { valido: false, errore: 'Email username SMTP non valida' };
  if (!config.pass || config.pass.trim() === '') return { valido: false, errore: 'Password SMTP mancante' };
  return { valido: true, errore: null };
}

describe('Omnichannel Communications & SMTP Verification Suite', () => {
  it('deve validare una configurazione SMTP corretta', () => {
    const configValida = {
      host: 'smtp.register.it',
      port: 587,
      user: 'comunicazioni@bluecode.advisory',
      pass: 'SecretPassword123!',
    };

    const res = validaConfigurazioneSmtp(configValida);
    expect(res.valido).toBe(true);
    expect(res.errore).toBeNull();
  });

  it('deve rifiutare una configurazione SMTP incompleta o errata', () => {
    const configErrata = {
      host: '',
      port: 587,
      user: 'invalido',
      pass: '',
    };

    const res = validaConfigurazioneSmtp(configErrata);
    expect(res.valido).toBe(false);
    expect(res.errore).toBe('Host SMTP mancante');
  });

  // L'handshake di verifica del webhook si prova sulla rotta vera, non su due letterali
  // confrontati fra loro. Prima questi due test erano `'x' === 'x'` con dentro il verify token
  // di produzione: non toccavano `src/routes/webhooks.ts`, e intanto pubblicavano il segreto.
  //
  // Da quando il token è **per studio** (app Meta dello studio, path con lo slug) qui si può
  // verificare solo la parte che non dipende dal database: uno slug che non risolve nessuno
  // studio deve rifiutare, senza mai cadere su un token di piattaforma o su un tenant
  // predefinito. I casi con lo studio risolto — token giusto, token sbagliato, token di
  // piattaforma — stanno in `src/webhooksSicurezza.test.ts`, dove il database è simulato e lo
  // studio ha davvero un Verify Token da confrontare.
  describe('handshake di verifica del webhook Meta (GET /webhooks/communications/whatsapp/:slug)', () => {
    // Il verify token di produzione che circolava in chiaro non si trascrive qui nemmeno per
    // provarlo: lo cerca `src/credenziali.test.ts` in tutti i sorgenti, ed è quello il suo posto.
    // A questo livello il valore è irrilevante — se lo slug non risolve uno studio, non esiste
    // token che apra l'handshake — quindi si usano stringhe inventate.
    const TOKEN_PUBBLICO = 'token-pubblico-inventato-per-la-prova';
    const SEGRETI_PUBBLICI = [TOKEN_PUBBLICO, 'verify-token-solo-per-i-test'];

    beforeEach(() => {
      for (const nome of ['WA_VERIFY_TOKEN', 'WA_APP_SECRET']) delete process.env[nome];
    });

    function server() {
      return buildServer(new InMemoryApp()) as any;
    }

    const handshake = (slug: string, token: string) => server().inject({
      method: 'GET',
      url: `/webhooks/communications/whatsapp/${slug}`,
      query: { 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': '1158201444' },
    });

    it('uno slug che non risolve nessuno studio rifiuta, chiunque sia il chiamante', async () => {
      const slug = 'a'.repeat(32);
      const senzaToken = await handshake(slug, '');
      const conTokenInventato = await handshake(slug, 'token-a-caso');
      expect([senzaToken.statusCode, conTokenInventato.statusCode]).toEqual([404, 404]);
      expect(senzaToken.body).not.toContain('1158201444');
    });

    it('nessun segreto pubblico supera l\'handshake, né come variabile d\'ambiente né come slug', async () => {
      process.env.WA_VERIFY_TOKEN = TOKEN_PUBBLICO;
      for (const segreto of SEGRETI_PUBBLICI) {
        // Come slug: non è nemmeno un path valido, quindi non si arriva a confrontare token.
        expect((await handshake(segreto, segreto)).statusCode).toBe(404);
      }
      // E la variabile d'ambiente non viene letta da nessuna parte: l'handshake resta chiuso.
      expect((await handshake('b'.repeat(32), TOKEN_PUBBLICO)).statusCode).toBe(404);
    });
  });

  it('deve associare correttamente un messaggio WhatsApp entrante al Cliente ERP ed al Progetto', () => {
    const clientiMock = [
      { id: 'cl-01', nome: 'Holding Beta S.r.l.', telefono: '+39 02 889900', referentiJson: { cellulare: '+39 335 1234567' } },
      { id: 'cl-02', nome: 'Roberto Rossi', telefono: '+39 335 1234567', referentiJson: {} },
    ];

    const mittenteFromMeta = '393351234567';

    // Algoritmo di matching telefonico
    const clienteTrovato = clientiMock.find(c => {
      const telClean = (c.telefono || '').replace(/\D/g, '');
      const ref = c.referentiJson && typeof c.referentiJson === 'object' ? (c.referentiJson as any) : {};
      const refCellClean = (ref.cellulare || ref.whatsapp || ref.telefono || '').replace(/\D/g, '');
      return (telClean && mittenteFromMeta.includes(telClean)) || (refCellClean && mittenteFromMeta.includes(refCellClean));
    });

    expect(clienteTrovato).toBeDefined();
    expect(clienteTrovato?.nome).toBe('Holding Beta S.r.l.');
  });
});

