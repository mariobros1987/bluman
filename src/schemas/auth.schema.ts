import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email('Email non valida').max(255).transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1, 'Password richiesta').max(256),
});

export const MagicLoginSchema = z.object({
  token: z.string().min(10, 'Token non valido').max(500),
});

export const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Vecchia password richiesta'),
  newPassword: z.string().min(8, 'La nuova password deve contenere almeno 8 caratteri').max(256),
});
