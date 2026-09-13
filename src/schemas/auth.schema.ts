import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email('Email non valida').max(255).transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1, 'Password richiesta').max(256),
});

export const MagicLoginSchema = z.object({
  magicToken: z.string().min(10, 'Token non valido').max(500),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, 'La nuova password deve contenere almeno 8 caratteri').max(256),
});

// PUT /auth/profilo — nome e specializzazione del profilo operatore. Entrambi facoltativi
// (si può aggiornare l'uno senza l'altro), ma quando ci sono devono essere stringhe sane:
// prima `req.body` arrivava crudo al Prisma update, e un tipo sbagliato (numero, oggetto)
// diventava un 500 di validazione Prisma invece di un 400 pulito.
export const ProfiloSchema = z.object({
  nome: z.string().min(1).max(120).optional(),
  specializzazione: z.string().max(255).optional(),
});
