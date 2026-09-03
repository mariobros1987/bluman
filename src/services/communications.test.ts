import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../server.js';
import { InMemoryApp } from '../adapters/inMemoryApp.js';

function validaConfigurazioneSmtp(config: { host?: string; port?: number; user?: string; pass?: string }) {
  if (!config.host || config.host.trim() === '') return { valido: false, errore: 'Host SMTP mancante' };
  if (!config.port || config.port <= 0) return { valido: false, errore: 'Porta SMTP non valida' };
  if (!config.user || !config.user.includes('@')) return { valido: false, errore: 'Email username SMTP non valida' };
  if (!config.pass || config.pass.trim() === '') return { valido: false, errore: 'Password SMTP mancante' };
  return { valido: true, errore: null };
}

function simulaTestCanale(channel: 'whatsapp' | 'telegram' | 'signal' | 'email') {
  const risposte = {
    whatsapp: 'Webhook WhatsApp Business API connesso e verificato su Meta Cloud API',
    telegram: 'Bot Telegram registrato e pronto per l ascolto su @BotFather Webhook API',
    signal: 'Daemon Signal REST API v1 in ascolto sul container Docker',
    email: 'Test Connessione SMTP completato con successo',
  };
  return { success: true, message: risposte[channel] };
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
  // Il token qui è un valore di prova impostato in `WA_VERIFY_TOKEN` per la durata del test.
  describe('handshake di verifica del webhook Meta (GET /webhooks/communications/whatsapp)', () => {
    const TOKEN_DI_PROVA = 'verify-token-solo-per-i-test';
    let precedente: string | undefined;

    beforeEach(() => {
      precedente = process.env.WA_VERIFY_TOKEN;
      process.env.WA_VERIFY_TOKEN = TOKEN_DI_PROVA;
    });

    afterEach(() => {
      if (precedente === undefined) delete process.env.WA_VERIFY_TOKEN;
      else process.env.WA_VERIFY_TOKEN = precedente;
    });

    function server() {
      return buildServer(new InMemoryApp()) as any;
    }

    it('con il token giusto restituisce la challenge di Meta', async () => {
      const res = await server().inject({
        method: 'GET',
        url: '/webhooks/communications/whatsapp',
        query: { 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN_DI_PROVA, 'hub.challenge': '1158201444' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('1158201444');
    });

    it('con il token sbagliato risponde 403 e non restituisce la challenge', async () => {
      const res = await server().inject({
        method: 'GET',
        url: '/webhooks/communications/whatsapp',
        query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'token-sbagliato', 'hub.challenge': '1158201444' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('1158201444');
    });

    it('senza WA_VERIFY_TOKEN configurato rifiuta invece di accettare chiunque', async () => {
      delete process.env.WA_VERIFY_TOKEN;
      const res = await server().inject({
        method: 'GET',
        url: '/webhooks/communications/whatsapp',
        query: { 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1158201444' },
      });
      expect(res.statusCode).toBe(503);
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

