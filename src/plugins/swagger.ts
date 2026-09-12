import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

/**
 * Registrazione della documentazione OpenAPI e dell'interfaccia interattiva Swagger UI.
 * Esposta su `/docs`, con specifica OpenAPI 3.0.3, security scheme BearerAuth e tag di dominio.
 */
export async function registraSwagger(server: FastifyInstance): Promise<void> {
  await server.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'BluMan Advisory Platform API',
        description:
          'Documentazione interattiva OpenAPI / Swagger dell\'API di BluMan (Multi-tenant ERP & Workflow per studi professionali ed advisory societaria).',
        version: '1.0.0',
        contact: {
          name: 'Supporto Tecnico BluMan',
          email: 'supporto@bluman.test',
        },
      },
      servers: [
        {
          url: '/',
          description: 'Server corrente (locale / produzione Railway)',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Inserisci il token JWT rilasciato da POST /auth/login o POST /auth/magic-login',
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
      tags: [
        { name: 'Auth', description: 'Autenticazione, login credenziali, magic link e rinnovo sessioni' },
        { name: 'Tenant', description: 'Gestione tenant studio, configurazione team e permessi RBAC granulari' },
        { name: 'Clienti', description: 'Anagrafica clienti ERP, fascicoli societari e profilazione fiscale' },
        { name: 'Progetti', description: 'Progetti, preventivi, distinta base (BOM), microvoci ed esecuzione' },
        { name: 'Contabilità', description: 'Fatturazione elettronica SdI (FatturaPA 1.2.2), Prima Nota e Scadenzario' },
        { name: 'Documenti', description: 'Document Studio, modelli Word/HTML, vault di progetto e fascicolo ZIP' },
        { name: 'Firma Elettronica', description: 'Firma Elettronica Avanzata (FEA) OTP, sigillo forense e controfirma Studio' },
        { name: 'Fornitori', description: 'Ciclo passivo OpenSTAManager-grade, anagrafica e fatture d\'acquisto' },
        { name: 'Comunicazioni', description: 'Dispatch omnichannel (WhatsApp Cloud API, SMTP Outbound, IMAP Inbound)' },
      ],
    },
  });

  await server.register(swaggerUi, {
    routePrefix: '/docs',
    initOAuth: {},
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
      persistAuthorization: true,
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
  });
}
