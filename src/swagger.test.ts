import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from './server.js';
import { InMemoryApp } from './adapters/inMemoryApp.js';
import { signJwt } from './util/jwt.js';

describe('FASE 6.2 — Documentazione OpenAPI e Swagger UI (/docs)', () => {
  let app: InMemoryApp;
  let server: ReturnType<typeof buildServer>;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    app = new InMemoryApp();
    server = buildServer(app);
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    await server.close();
  });

  it('GET /docs/json restituisce la specifica OpenAPI 3.0.3 valida', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/docs/json',
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);

    expect(json.openapi).toBe('3.0.3');
    expect(json.info).toBeDefined();
    expect(json.info.title).toBe('BluMan Advisory Platform API');
    expect(json.info.version).toBe('1.0.0');
    expect(json.components).toBeDefined();
    expect(json.components.securitySchemes).toBeDefined();
    expect(json.components.securitySchemes.bearerAuth).toBeDefined();
    expect(json.components.securitySchemes.bearerAuth.type).toBe('http');
    expect(json.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    expect(json.paths).toBeDefined();
    expect(typeof json.paths).toBe('object');
  });

  it('GET /docs restituisce l\'interfaccia HTML Swagger UI o reindirizzamento', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/docs/',
    });

    expect([200, 302]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('swagger-ui');
    }
  });

  it('in ambiente di sviluppo o test permette l\'accesso senza token', async () => {
    process.env.NODE_ENV = 'development';
    const devServer = buildServer(app);
    try {
      const res = await devServer.inject({
        method: 'GET',
        url: '/docs/json',
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await devServer.close();
    }
  });

  it('in produzione rifiuta accessi anonimi con 401', async () => {
    process.env.NODE_ENV = 'production';
    const prodServer = buildServer(app);
    try {
      const res = await prodServer.inject({
        method: 'GET',
        url: '/docs',
      });
      expect(res.statusCode).toBe(401);
      const json = JSON.parse(res.body);
      expect(json.errore).toContain('Accesso alla documentazione API riservato');
    } finally {
      await prodServer.close();
    }
  });

  it('in produzione rifiuta utenti con ruolo cliente con 403', async () => {
    process.env.NODE_ENV = 'production';
    const prodServer = buildServer(app);
    try {
      const tokenCliente = signJwt(
        { userId: 'cli-test', email: 'cliente@test.it', ruolo: 'cliente', sessionVersion: 0, tenantId: 'tenant-test' },
        60,
      );

      const res = await prodServer.inject({
        method: 'GET',
        url: '/docs',
        headers: {
          authorization: `Bearer ${tokenCliente}`,
        },
      });

      expect([401, 403]).toContain(res.statusCode);
      const json = JSON.parse(res.body);
      expect(json.errore).toMatch(/Accesso alla documentazione API riservato|Non autenticato/);
    } finally {
      await prodServer.close();
    }
  });
});
