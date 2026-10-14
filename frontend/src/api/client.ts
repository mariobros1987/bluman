// API Client per integrare il React Frontend con il backend Fastify + Supabase DB
export * from './http';
export * from './auth';
export * from './clienti';
export * from './progetti';
export * from './documenti';
// §41 — cartella modelli dello studio: `/documenti-template` e lo stato di revisione.
export * from './modelliDocumento';
export * from './libreria';
export * from './fatturazione';
export * from './portale';
export * from './firma';
export * from './tenant';
// §voce 8-bis — copia off-site del backup: credenziale (super admin) e freschezza (titolare).
export * from './backup';
export * from './notifiche';
export * from './report';
export * from './paginazione';
export * from './timesheet';
export * from './fornitori';
export * from './liquidazioneIva';
export * from './solleciti';
export * from './cache';
// Help in-app: le schede di `docs/manuale/`, servite dal backend come JSON.
export * from './manuale';
