import { getTenantStorageKey } from './tenant';

export type PermissionLevel = 'denied' | 'read' | 'write';

export function getUserPermission(user: any, moduleKey: string): PermissionLevel {
  if (!user) return 'denied';
  if (user.ruolo === 'super_admin') return 'write';
  if (moduleKey === 'dashboard') return 'write';

  const userKey = (user.id || '').toString().toLowerCase();
  const emailKey = (user.email || '').toLowerCase().trim();

  // 1. Controlla gli override specifici salvati nella Matrice Permessi per questo specifico utente
  // Prima le chiavi isolate per tenant (usate da OperatorDetailModal), poi i fallback legacy
  const candidateKeys = [
    emailKey ? getTenantStorageKey(`bluman_rbac_permissions_${emailKey}`) : '',
    emailKey ? getTenantStorageKey(`bluman_rbac_permissions_usr-${emailKey}`) : '',
    userKey ? getTenantStorageKey(`bluman_rbac_permissions_${userKey}`) : '',
    emailKey ? `bluman_rbac_permissions_${emailKey}` : '',
    emailKey ? `bluman_rbac_permissions_usr-${emailKey}` : '',
    userKey ? `bluman_rbac_permissions_${userKey}` : '',
  ].filter(Boolean);

  for (const k of candidateKeys) {
    const savedStr = localStorage.getItem(k);
    if (savedStr) {
      try {
        const perms = JSON.parse(savedStr);
        if (Array.isArray(perms)) {
          const found = perms.find((p: any) => p.moduloChiave === moduleKey);
          if (found && found.livello) {
            return found.livello as PermissionLevel;
          }
        }
      } catch {}
    }
  }

  // 2. Permessi di Default per Ruolo (quando non è stata ancora salvata una Matrice personalizzata)
  if (user.ruolo === 'advisor') {
    // Advisor/Partner hanno accesso a tutti i moduli operativi e impostazioni di studio
    if (['projects', 'clients', 'documents', 'calendar', 'retainers', 'invoices', 'settings', 'library', 'banks', 'primanota', 'scadenzario', 'reports'].includes(moduleKey)) {
      return 'write';
    }
    if (['audit', 'admin'].includes(moduleKey)) return 'denied';
    return 'write';
  }

  if (user.ruolo === 'collaboratore_interno' || user.ruolo === 'operator') {
    if (['projects', 'calendar', 'timesheet'].includes(moduleKey)) return 'write';
    if (['clients', 'documents', 'library'].includes(moduleKey)) return 'read';
    return 'denied'; // Invoices, Banche, Prima Nota, Scadenzario, Retainers, Audit, Settings bloccati
  }

  if (user.ruolo === 'collaboratore_esterno') {
    if (['projects', 'calendar', 'timesheet'].includes(moduleKey)) return 'write';
    if (['documents'].includes(moduleKey)) return 'read';
    return 'denied'; // Accesso solo ai documenti e progetti assegnati; clienti, fatture e contabilità bloccati
  }

  return 'denied';
}

