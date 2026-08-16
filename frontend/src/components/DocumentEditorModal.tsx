import React, { useState } from 'react';
import { DocumentEditorPage } from '../pages/DocumentEditorPage';

interface DocumentEditorModalProps {
  onClose: () => void;
  initialClienteId?: string;
  initialProgettoId?: string;
}

export function DocumentEditorModal({ onClose }: DocumentEditorModalProps) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(15, 23, 42, 0.85)',
      backdropFilter: 'blur(8px)',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      padding: '20px 30px',
      overflowY: 'auto',
    }}>
      <div style={{
        maxWidth: '1350px',
        width: '100%',
        margin: '0 auto',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 20,
        padding: '24px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
        position: 'relative',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--indigo-l)' }}>
            Studio Document Studio Overlay
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'var(--card2)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              width: 32,
              height: 32,
              borderRadius: '50%',
              fontSize: 14,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        <DocumentEditorPage />
      </div>
    </div>
  );
}
