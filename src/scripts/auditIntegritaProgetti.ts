/**
 * Script di Audit Integrità Dati Progetti, Rilevamento Cicli DAG & Bonifica Storica (FASE 4).
 *
 * Scopo architetturale:
 * - Scansiona tutti i progetti attivi per tenant (con isolamento RLS).
 * - Rileva dipendenze cicliche tra moduli (evitando DipendenzaCiclicaError a runtime).
 * - Identifica divergenze di avanzamento tra percentuali calcolate e memorizzate.
 * - Supporta modalità di sola lettura (--dry-run) e bonifica automatica (--fix).
 */

import { prisma, prismaAmministrativo, contestoTenant } from '../util/prismaClient.js';
import { calcolaAvanzamento, ricalcolaProgetto } from '../services/calcoloService.js';
import { trovaCicloDipendenze, type ArcoDipendenza } from '../services/dipendenzeModuli.js';

export interface AnomaliaProgetto {
  progettoId: string;
  progettoNome: string;
  tenantId: string;
  tipo: 'ciclo_dipendenze' | 'divergenza_avanzamento' | 'modulo_senza_voci';
  descrizione: string;
  dettagli?: any;
  bonificata?: boolean;
}

export interface ReportAuditIntegrita {
  timestamp: string;
  tenantEsaminati: number;
  progettiScansionati: number;
  progettiConAnomalie: number;
  anomalie: AnomaliaProgetto[];
  bonificheEseguite: number;
}

export interface OpzioniAudit {
  tenantId?: string;
  fix?: boolean;
}

/**
 * Esegue l'audit di integrità progetti per uno o tutti i tenant.
 */
export async function eseguiAuditIntegritaProgetti(
  opzioni: OpzioniAudit = {},
): Promise<ReportAuditIntegrita> {
  const { tenantId, fix = false } = opzioni;

  const report: ReportAuditIntegrita = {
    timestamp: new Date().toISOString(),
    tenantEsaminati: 0,
    progettiScansionati: 0,
    progettiConAnomalie: 0,
    anomalie: [],
    bonificheEseguite: 0,
  };

  // 1. Seleziona i tenant da analizzare (usando prismaAmministrativo solo per l'elenco)
  const queryTenant = tenantId
    ? { where: { id: tenantId, stato: 'attivo' }, select: { id: true, ragioneSociale: true } }
    : { where: { stato: 'attivo' }, select: { id: true, ragioneSociale: true } };

  const tenants = await prismaAmministrativo().tenant.findMany(queryTenant as any);
  report.tenantEsaminati = tenants.length;

  for (const t of tenants) {
    // Esegue l'audit nel contesto protetto del tenant (regola RLS)
    await contestoTenant.run({ tenantId: t.id, ruolo: 'super_admin' }, async () => {
      const progetti = await prisma.progetto.findMany({
        where: { tenantId: t.id },
        include: {
          moduli: {
            include: {
              microvoci: true,
            },
          },
        },
      });

      report.progettiScansionati += progetti.length;

      // Legge anche le dipendenze template del tenant per la verifica anti-ciclo
      const dipendenze = await prisma.moduloDipendenzaTemplate.findMany({
        where: { tenantId: t.id },
      });
      const archiTenant: ArcoDipendenza[] = dipendenze.map((d) => ({
        moduloTemplateId: d.moduloTemplateId,
        dipendeDaModuloTemplateId: d.dipendeDaModuloTemplateId,
      }));

      for (const p of progetti) {
        let haAnomalie = false;

        // 1. Verifica moduli vuoti (senza microvoci) nei progetti avviati
        if (p.stato !== 'pre_project') {
          for (const m of p.moduli) {
            if (!m.microvoci || m.microvoci.length === 0) {
              report.anomalie.push({
                progettoId: p.id,
                progettoNome: p.nome,
                tenantId: t.id,
                tipo: 'modulo_senza_voci',
                descrizione: `Il modulo «${m.nome}» (${m.id}) non ha microvoci operative configurate.`,
                bonificata: false,
              });
              haAnomalie = true;
            }
          }
        }

        // 2. Verifica cicli di dipendenza tra i moduli del progetto
        const moduliConTemplate = p.moduli.filter((m) => m.moduloTemplateId);
        for (const m of moduliConTemplate) {
          if (!m.moduloTemplateId) continue;
          const deps = dipendenze
            .filter((d) => d.moduloTemplateId === m.moduloTemplateId)
            .map((d) => d.dipendeDaModuloTemplateId);

          const ciclo = trovaCicloDipendenze(archiTenant, m.moduloTemplateId, deps);
          if (ciclo) {
            report.anomalie.push({
              progettoId: p.id,
              progettoNome: p.nome,
              tenantId: t.id,
              tipo: 'ciclo_dipendenze',
              descrizione: `Rilevato ciclo di dipendenza nel modulo «${m.nome}»: ${ciclo.join(' -> ')}`,
              dettagli: { ciclo },
              bonificata: false,
            });
            haAnomalie = true;
          }
        }

        // 3. Verifica divergenze di avanzamento percentuale
        const avanzamentoReale = calcolaAvanzamento(p as any);
        const avanzamentoAttuale = (p as any).avanzamentoPercentuale;

        if (
          typeof avanzamentoAttuale === 'number' &&
          avanzamentoAttuale !== avanzamentoReale.percentuale
        ) {
          let bonificata = false;
          if (fix) {
            try {
              await ricalcolaProgetto(p.id);
              bonificata = true;
              report.bonificheEseguite += 1;
            } catch {
              bonificata = false;
            }
          }

          report.anomalie.push({
            progettoId: p.id,
            progettoNome: p.nome,
            tenantId: t.id,
            tipo: 'divergenza_avanzamento',
            descrizione: `Divergenza avanzamento su «${p.nome}»: registrato ${avanzamentoAttuale}%, effettivo ricalcolato ${avanzamentoReale.percentuale}%.`,
            dettagli: {
              registrato: avanzamentoAttuale,
              reale: avanzamentoReale.percentuale,
            },
            bonificata,
          });
          haAnomalie = true;
        }

        if (haAnomalie) {
          report.progettiConAnomalie += 1;
        }
      }
    });
  }

  return report;
}

// Esecuzione CLI standalone
if (process.argv[1]?.endsWith('auditIntegritaProgetti.ts') || process.argv[1]?.endsWith('auditIntegritaProgetti.js')) {
  const isFix = process.argv.includes('--fix');
  const tenantArg = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1];

  console.log('🔍 [AUDIT PROGETTI] Avvio scansione integrità progetti...');
  if (isFix) {
    console.log('⚡ Modalità: CORREZIONE ATTIVA (--fix)');
  } else {
    console.log('📖 Modalità: SOLA LETTURA (--dry-run)');
  }

  eseguiAuditIntegritaProgetti({ tenantId: tenantArg, fix: isFix })
    .then((rep) => {
      console.log('\n📊 --- REPORT AUDIT INTEGRITÀ PROGETTI ---');
      console.log(`• Tenant analizzati: ${rep.tenantEsaminati}`);
      console.log(`• Progetti scansionati: ${rep.progettiScansionati}`);
      console.log(`• Progetti con anomalie: ${rep.progettiConAnomalie}`);
      console.log(`• Anomalie riscontrate: ${rep.anomalie.length}`);
      console.log(`• Bonifiche eseguite: ${rep.bonificheEseguite}`);

      if (rep.anomalie.length > 0) {
        console.log('\n⚠️ Dettaglio Anomalie:');
        for (const a of rep.anomalie) {
          const stato = a.bonificata ? '✅ BONIFICATA' : '❌ DA CORREGGERE';
          console.log(`  [${a.tipo}] [${stato}] Progetto «${a.progettoNome}» (${a.progettoId}): ${a.descrizione}`);
        }
      } else {
        console.log('\n✅ Tutti i progetti esaminati risultano perfettamente integri e coerenti.');
      }

      const anomalieNonBonificate = rep.anomalie.filter((a) => !a.bonificata).length;
      if (anomalieNonBonificate > 0 && !isFix) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('❌ Errore fatale durante l\'audit dei progetti:', err);
      process.exit(2);
    });
}
