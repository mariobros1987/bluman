import React from 'react';
import { captureException } from '../utils/sentry';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  errore: Error | null;
}

/**
 * Argine di ultima istanza: senza di lui un errore di render in qualunque pagina
 * smontava l'intera SPA, e l'operatore restava su una schermata bianca senza né
 * messaggio né via d'uscita. L'ErrorBoundary cattura l'errore, lo mostra con un
 * messaggio onesto (regola 7: niente «operazione completata» su un crash) e offre
 * il ricaricamento — che nella maggior parte dei casi ripristina lo stato perché
 * la sessione sta in localStorage e si ricarica da sé.
 *
 * L'errore NON viene nascosto: è scritto in pagina (troncato), perché quando lo
 * studio segnala «la pagina è bianca» la stringa esatta è l'informazione che
 * serve per riprodurre.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { errore: null };

  static getDerivedStateFromError(errore: Error): ErrorBoundaryState {
    return { errore };
  }

  componentDidCatch(errore: Error, info: React.ErrorInfo) {
    // In console con il componente stack: chi sviluppa lo vede subito.
    console.error('[ErrorBoundary] Errore di render non gestito:', errore, info.componentStack);
    // Su Sentry (se configurato) con lo stack dei componenti come extra: dice
    // QUALE pagina è esplosa, non solo l'errore. No-op senza VITE_SENTRY_DSN.
    captureException(errore, {
      tags: { contesto: 'ErrorBoundary' },
      extra: info.componentStack ? { componentStack: info.componentStack } : undefined,
    });
  }

  render() {
    if (!this.state.errore) return this.props.children;

    const messaggio = String(this.state.errore.message || this.state.errore).slice(0, 300);

    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg, #0b0e1a)',
        padding: 24,
        boxSizing: 'border-box',
      }}>
        <div style={{
          maxWidth: 560,
          width: '100%',
          background: 'var(--card, #141928)',
          border: '1px solid #7f1d1d',
          borderRadius: 16,
          padding: 32,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ color: '#f87171', fontSize: 20, margin: '0 0 12px 0' }}>
            Si è verificato un errore imprevisto
          </h1>
          <p style={{ color: 'var(--muted, #9ca3af)', fontSize: 13, lineHeight: 1.6, margin: '0 0 16px 0' }}>
            La pagina ha smesso di funzionare per un errore interno. La sessione è salva:
            ricaricando si torna al punto di partenza. Se l'errore si ripete, comunica
            anche il dettaglio qui sotto.
          </p>
          <pre style={{
            textAlign: 'left',
            background: 'rgba(127,29,29,.15)',
            border: '1px solid rgba(127,29,29,.4)',
            borderRadius: 8,
            color: '#fca5a5',
            fontSize: 11,
            padding: '10px 12px',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: '0 0 20px 0',
          }}>
            {messaggio}
          </pre>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#4f46e5',
                color: '#fff',
                border: 'none',
                padding: '10px 22px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              🔄 Ricarica l'applicazione
            </button>
            <button
              onClick={() => this.setState({ errore: null })}
              style={{
                background: 'transparent',
                color: 'var(--muted, #9ca3af)',
                border: '1px solid var(--border, #2a3049)',
                padding: '10px 22px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Riprova senza ricaricare
            </button>
          </div>
        </div>
      </div>
    );
  }
}
