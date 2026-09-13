// Presidio dell'isolamento tenant sui file del fallback locale (§ regola 1, AGENTS.md).
//
// Il difetto che questo file impedisce di reintrodurre: `GET /uploads/:filename` accettava
// il Bearer di QUALSIASI tenant autenticato. RLS protegge le righe di database, ma i file
// del fallback locale stanno su disco, dove non esistono policy: l'unica chiave disponibile
// in lettura è il prefisso `<tenantId>_` che `uploadDocumento` scrive nel nome da quando
// esiste questo presidio. Un operatore dello studio A che indovinasse l'URL di un file
// dello studio B riceveva il contenuto; ora riceve 404.
//
// Come `accessoCliente.test.ts`, il client Prisma è fintto: qui non si tocca il database,
// si osserva il comportamento della rotta sui file veri della cartella `uploads/`.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const finto: any = {
    auditLog: { create: async () => ({}) },
    user: { findFirst: async () => null },
    tenant: { findUnique: async () => null },
    $executeRaw: async () => 1,
  };
  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt, firmaDownload } = await import('./util/jwt.js');
const { CARTELLA_UPLOADS, tenantDaNomeFile } = await import('./services/storageService.js');

const TENANT_STUDIO = '00000000-0000-0000-0000-000000000001';
const TENANT_ALTRO = '00000000-0000-0000-0000-000000000002';

function server() {
  return buildServer(new InMemoryApp()) as any;
}

function tokenAdvisor(tenantId: string) {
  return signJwt({ userId: 'usr-advisor', tenantId, email: 'advisor@studio.example', ruolo: 'advisor', sessionVersion: 0 });
}

function tokenSuperAdmin() {
  return signJwt({ userId: 'usr-super', tenantId: '', email: 'super@bluman.example', ruolo: 'super_admin', sessionVersion: 0 });
}

describe('tenantDaNomeFile — il prefisso dichiara il proprietario', () => {
  it('estrae il tenant dai nomi prodotti da uploadDocumento', () => {
    expect(tenantDaNomeFile(`${TENANT_ALTRO}_1757777000000_attivo.pdf`)).toBe(TENANT_ALTRO);
    expect(tenantDaNomeFile(`${TENANT_STUDIO}_1757777000000_logo.png`)).toBe(TENANT_STUDIO);
  });

  it('non vede tenant dove non c\'è: i nomi storici restano senza proprietario', () => {
    expect(tenantDaNomeFile('1757777000000_attivo.pdf')).toBeNull();
    expect(tenantDaNomeFile('logo.png')).toBeNull();
  });

  it('riconosce solo un UUID vero, non una sequenza simile', () => {
    expect(tenantDaNomeFile('not-a-uuid_1757777000000_attivo.pdf')).toBeNull();
    expect(tenantDaNomeFile('00000000-0000-0000-0000-00000000000X_1757777000000_attivo.pdf')).toBeNull();
  });
});

describe('GET /uploads/:filename — il file serve solo al suo studio', () => {
  // Il nome con il prefisso dell'ALTRO studio: esattamente la forma che produce oggi
  // uploadDocumento per uno studio diverso da quello del test.
  const NOME_ALTRO = `${TENANT_ALTRO}_1757777000000_riservato.pdf`;
  const NOME_STORICO = '1757777000000_logo_storico.png';
  const percorsi = [NOME_ALTRO, NOME_STORICO].map(n => path.join(CARTELLA_UPLOADS, n));

  beforeEach(() => {
    if (!fs.existsSync(CARTELLA_UPLOADS)) fs.mkdirSync(CARTELLA_UPLOADS, { recursive: true });
    // Un PDF vero per il file dell'altro studio (la scansione magic-bytes avviene in
    // scrittura, non in lettura: qui conta solo che il file esista e sia servibile).
    fs.writeFileSync(path.join(CARTELLA_UPLOADS, NOME_ALTRO), Buffer.from('%PDF-1.7\ncontenuto riservato\n%%EOF'));
    fs.writeFileSync(path.join(CARTELLA_UPLOADS, NOME_STORICO), Buffer.from('89504e470d0a1a0a', 'hex'));
  });

  afterAll(() => {
    for (const p of percorsi) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  it('rifiuta con 404 il file di un altro studio all\'operatore autenticato', async () => {
    const app = server();
    const res = await app.inject({
      method: 'GET',
      url: `/uploads/${NOME_ALTRO}`,
      headers: { authorization: `Bearer ${tokenAdvisor(TENANT_STUDIO)}` },
    });
    // 404 e non 403: la negazione non deve confermare che il file esiste.
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('riservato');
  });

  it('serve lo stesso file all\'operatore dello studio proprietario', async () => {
    const app = server();
    const res = await app.inject({
      method: 'GET',
      url: `/uploads/${NOME_ALTRO}`,
      headers: { authorization: `Bearer ${tokenAdvisor(TENANT_ALTRO)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('riservato');
  });

  it('il super_admin vede i file di tutti i tenant (tenant_id NULL, §2bis)', async () => {
    const app = server();
    const res = await app.inject({
      method: 'GET',
      url: `/uploads/${NOME_ALTRO}`,
      headers: { authorization: `Bearer ${tokenSuperAdmin()}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('la firma HMAC vale per se stessa, come prima: è il server a emetterla', async () => {
    const { firma, scad } = firmaDownload(NOME_ALTRO);
    const app = server();
    const res = await app.inject({
      method: 'GET',
      url: `/uploads/${NOME_ALTRO}?firma=${firma}&scad=${scad}`,
    });
    expect(res.statusCode).toBe(200);
  });

  it('i file storici senza prefisso restano leggibili: nessuna rottura retroattiva', async () => {
    const app = server();
    const res = await app.inject({
      method: 'GET',
      url: `/uploads/${NOME_STORICO}`,
      headers: { authorization: `Bearer ${tokenAdvisor(TENANT_STUDIO)}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
