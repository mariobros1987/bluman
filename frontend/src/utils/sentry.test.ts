// Test del wrapper Sentry del frontend — il contratto da presidiare è uno:
// l'error tracking è opt-in per costruzione. Senza VITE_SENTRY_DSN l'SDK non
// viene nemmeno importato (zero chunk scaricati, zero rete), e captureException
// è un no-op che i chiamanti non devono pensare. Con il DSN, init parte una
// volta sola e gli errori passano con i loro tag.
//
// @sentry/react è interamente mockato: questi test verificano il contratto del
// wrapper, non l'SDK di Sentry.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockInit = vi.fn();
const mockCaptureException = vi.fn();

vi.mock('@sentry/react', () => ({
  init: mockInit,
  captureException: mockCaptureException,
}));

// Ogni test importa il wrapper su stato vergine: `client` è a livello di modulo
// e un test che inizializza Sentry non deve falsificare il successivo.
async function wrapperVergine() {
  vi.resetModules();
  return import('../utils/sentry');
}

beforeEach(() => {
  mockInit.mockClear();
  mockCaptureException.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('initSentry — opt-in per costruzione', () => {
  it('senza VITE_SENTRY_DSN non carica né inizializza nulla', async () => {
    const { initSentry } = await wrapperVergine();

    await initSentry();

    expect(mockInit).not.toHaveBeenCalled();
  });

  it('con il DSN inizializza una sola volta, anche sotto StrictMode', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://publico@sentry.test/1');
    const { initSentry } = await wrapperVergine();

    await initSentry();
    await initSentry(); // StrictMode monta due volte: la seconda è no-op.

    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://publico@sentry.test/1',
      sendDefaultPii: false,
      tracesSampleRate: 0,
    }));
  });
});

describe('captureException — no-op finché non c\'è un client', () => {
  it('senza DSN non fa nulla e non solleva', async () => {
    const { captureException } = await wrapperVergine();

    expect(() => captureException(new Error('boom'))).not.toThrow();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('dopo l\'inizializzazione inoltra errore, tag ed extra', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://publico@sentry.test/1');
    const { initSentry, captureException } = await wrapperVergine();
    await initSentry();

    const errore = new Error('render esploso');
    captureException(errore, {
      tags: { contesto: 'ErrorBoundary' },
      extra: { componentStack: 'at Dashboard\n  at App' },
    });

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(errore, {
      tags: { contesto: 'ErrorBoundary' },
      extra: { componentStack: 'at Dashboard\n  at App' },
    });
  });
});
