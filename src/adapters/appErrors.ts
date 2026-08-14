// Errori applicativi condivisi — sia InMemoryApp che PrismaApp li lanciano,
// il server li mappa agli status HTTP giusti (src/server.ts) indipendentemente
// da quale implementazione è dietro.

export class ClienteNonTrovatoError extends Error {}
export class ProgettoNonTrovatoError extends Error {}
export class PreventivoNonTrovatoError extends Error {}
export class ModuloNonTrovatoError extends Error {}
export class TransizioneNonValidaError extends Error {}
