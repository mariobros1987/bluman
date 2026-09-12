import { describe, it, expect } from 'vitest';
import { ottieniConfigurazioneLogger } from './server.js';

describe('FASE 3 — Logging Strutturato Pino & Tracciabilità Railway', () => {
  it('disattiva il logger durante i test vitest standard per mantenere i test puliti', () => {
    const config = ottieniConfigurazioneLogger();
    expect(config).toBe(false);
  });

  it('include tutti i campi sensibili nelle regole di censura (redact policy)', () => {
    const prevEnv = process.env.TEST_LOG;
    try {
      process.env.TEST_LOG = '1';
      const config: any = ottieniConfigurazioneLogger();
      expect(config).not.toBe(false);
      expect(config.level).toBeDefined();
      expect(config.redact).toContain('req.headers.authorization');
      expect(config.redact).toContain('req.headers.cookie');
      expect(config.redact).toContain('*.password');
      expect(config.redact).toContain('*.token');
      expect(config.redact).toContain('*.codiceOtp');
      expect(config.redact).toContain('*.waAccessToken');
      expect(config.redact).toContain('*.smtpPass');
    } finally {
      if (prevEnv !== undefined) {
        process.env.TEST_LOG = prevEnv;
      } else {
        delete process.env.TEST_LOG;
      }
    }
  });

  it('serializza correttamente i campi essenziali della richiesta HTTP (req)', () => {
    const prevEnv = process.env.TEST_LOG;
    try {
      process.env.TEST_LOG = '1';
      const config: any = ottieniConfigurazioneLogger();
      expect(config.serializers?.req).toBeDefined();

      const fintaReq = {
        id: 'req-123',
        method: 'POST',
        url: '/documenti/doc-1/firma-studio',
        routeOptions: { url: '/documenti/:id/firma-studio' },
        ip: '192.168.1.1',
        tenantId: 'tenant-456',
        userId: 'user-789',
        ruolo: 'advisor',
      };

      const serializzato = config.serializers.req(fintaReq);

      expect(serializzato).toEqual({
        id: 'req-123',
        method: 'POST',
        url: '/documenti/doc-1/firma-studio',
        path: '/documenti/:id/firma-studio',
        ip: '192.168.1.1',
        tenantId: 'tenant-456',
        userId: 'user-789',
        ruolo: 'advisor',
      });
    } finally {
      if (prevEnv !== undefined) {
        process.env.TEST_LOG = prevEnv;
      } else {
        delete process.env.TEST_LOG;
      }
    }
  });
});
