import type { CSSProperties } from 'react';

export const portalWrapperStyle: CSSProperties = {
  width: '100%',
  minHeight: '100vh',
  overflowY: 'auto',
  background: 'var(--bg)',
  color: 'var(--text)',
};

export const containerStyle: CSSProperties = {
  minHeight: '100%',
  color: 'var(--text)',
  fontFamily: 'var(--font)',
  padding: '24px 20px 80px',
  maxWidth: 1120,
  margin: '0 auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
};

export const topNavStyle: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
  paddingBottom: 14, borderBottom: '1px solid var(--border)',
};

// Colori dai token del tema: il fondo scuro scritto a mano rendeva illeggibile il nome
// dell'incarico nel tema chiaro (testo scuro del tema su fondo sempre scuro).
export const heroBannerStyle: CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)', borderLeft: '4px solid var(--indigo)', borderRadius: 16, padding: '20px 24px',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, boxShadow: 'var(--shadow)',
};

export const tabsBarStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  overflowX: 'auto',
  borderBottom: '2px solid var(--border)',
  paddingBottom: 10,
  paddingTop: 6,
  position: 'sticky',
  top: 0,
  zIndex: 30,
  background: 'var(--bg)',
};

export const tabBtnStyle = (active: boolean): CSSProperties => ({
  background: active ? 'var(--indigo)' : 'var(--card2)',
  border: active ? '1px solid var(--indigo-l)' : '1px solid var(--border)',
  color: active ? '#ffffff' : 'var(--text)',
  fontSize: 13,
  fontWeight: 700,
  padding: '10px 18px',
  borderRadius: 10,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  boxShadow: active ? '0 4px 14px rgba(99, 102, 241, 0.4)' : 'none',
  transition: 'all .2s ease',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
});

export const bodyStyle: CSSProperties = {
  flex: 1,
};

export const docBoxStyle: CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, boxShadow: '0 12px 36px rgba(0,0,0,.3)',
};
