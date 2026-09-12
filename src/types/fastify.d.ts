import 'fastify';
import type { JwtPayload } from '../util/jwt.js';
import type { Ruolo } from '../util/authorization.js';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    ruolo?: Ruolo;
    user?: JwtPayload | null;
    userId?: string;
    clienteId?: string;
  }
}
