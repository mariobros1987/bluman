// Seed — popola un tenant di prova e la libreria (Articoli + Moduli con distinta base)
// usando gli stessi dati del quick start in-memory (seedData.ts), così i due percorsi
// delle istruzioni di installazione mostrano la stessa cosa.
//
// ⚠️ Come gli altri file in questa cartella, mai eseguito in questo ambiente. Verificalo
// sulla tua macchina dopo `prisma migrate dev`.
//
//   npm run seed

import { PrismaClient } from '@prisma/client';
import { moduloAnalisiPatrimoniale, moduloCorporateStructuring } from '../../scripts/seedData.js';
import type { ModuloTemplateConDistinta } from '../../services/istanziazionePort.js';

const prisma = new PrismaClient();

async function seedModulo(tenantId: string, template: ModuloTemplateConDistinta) {
  const modulo = await prisma.moduloTemplate.create({
    data: {
      tenantId,
      nome: template.nome,
      categoria: template.categoria,
      versione: template.versione,
      prezzoPacchetto: template.prezzoPacchetto,
    },
  });

  for (const [idx, riga] of template.righe.entries()) {
    // Un articolo può comparire in più moduli (§3bis): upsert per nome+tenant invece di
    // ricrearlo ogni volta — evita duplicati se il seed viene lanciato più di una volta
    // per errore. `nome` non è unique nello schema: qui usiamo findFirst+create come
    // semplificazione accettabile per uno script di seed, non per codice applicativo.
    let articolo = await prisma.articolo.findFirst({ where: { tenantId, nome: riga.articoloNome } });
    if (!articolo) {
      articolo = await prisma.articolo.create({
        data: {
          tenantId,
          nome: riga.articoloNome,
          categoria: template.categoria,
          versione: riga.articoloVersione,
          oreDefault: riga.oreEffettive,
          prezzoDefault: riga.prezzoEffettivo,
        },
      });
      for (const p of riga.passaggi) {
        await prisma.passaggioTemplate.create({
          data: {
            articoloId: articolo.id,
            titolo: p.titolo,
            tipo: p.tipo,
            chi: p.chi,
            ordine: p.ordine,
            descrizione: p.descrizione,
            campiFormJson: p.campiFormJson as never,
          },
        });
      }
    }

    await prisma.rigaDistinta.create({
      data: {
        tenantId,
        moduloTemplateId: modulo.id,
        articoloId: articolo.id,
        articoloVersione: articolo.versione,
        ordine: idx + 1,
        quantita: riga.quantita,
      },
    });
  }

  return modulo;
}

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      ragioneSociale: 'Bluecode Advisory (demo)',
      piano: 'trial',
      stato: 'attivo',
    },
  });

  const m01 = await seedModulo(tenant.id, moduloAnalisiPatrimoniale);
  const m02 = await seedModulo(tenant.id, moduloCorporateStructuring);

  // dipendenza M02 -> M01 (§7ter), coerente con moduloCorporateStructuring.dipendenzeDa
  await prisma.moduloDipendenzaTemplate.create({
    data: { tenantId: tenant.id, moduloTemplateId: m02.id, dipendeDaModuloTemplateId: m01.id },
  });

  // ── Creazione Progetti Istituzionali nel DB PostgreSQL ───────────────
  let clienteDemo = await prisma.cliente.findFirst({ where: { tenantId: tenant.id, nome: 'Holding Beta S.r.l.' } });
  if (!clienteDemo) {
    clienteDemo = await prisma.cliente.create({
      data: {
        tenantId: tenant.id,
        nome: 'Holding Beta S.r.l.',
        tipo: 'company',
        partitaIva: 'IT09876543210',
        codiceFiscale: 'BLUCD90A01H501X',
        sedeLegale: 'Via Montenapoleone 8, Milano',
        codiceSdi: 'SUBM70N',
        email: 'client@holdingbeta.advisory',
      },
    });
  }

  const p1 = await prisma.progetto.upsert({
    where: { id: 'proj-db-001' },
    update: {},
    create: {
      id: 'proj-db-001',
      tenantId: tenant.id,
      clienteId: clienteDemo.id,
      nome: 'Structuring Holding Malta & IP',
      stato: 'in_progress',
      valoreTotale: 1500000,
      moduli: {
        create: [
          {
            tenantId: tenant.id,
            moduloTemplateId: m01.id,
            moduloTemplateVersione: 1,
            nome: 'Analisi patrimoniale iniziale',
            categoria: 'Analisi',
            prezzo: 350000,
            orePreventivate: 20,
            stato: 'done',
          },
          {
            tenantId: tenant.id,
            moduloTemplateId: m02.id,
            moduloTemplateVersione: 1,
            nome: 'Corporate structuring Malta',
            categoria: 'Societario',
            prezzo: 1150000,
            orePreventivate: 40,
            stato: 'in_progress',
          },
        ],
      },
    },
  });

  console.log('Seed completato.');
  console.log('Tenant:', tenant.id, tenant.ragioneSociale);
  console.log('Progetto DB:', p1.nome, 'ID:', p1.id);
}

main()
  .catch((err) => {
    console.error('Seed fallito:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
