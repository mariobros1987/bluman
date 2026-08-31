import 'fastify';
import type { JwtPayload } from '../util/jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    ruolo?: string;
    user?: JwtPayload | null;
    userId?: string;
    clienteId?: string;
  }
}
