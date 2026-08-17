// Utility RBAC - Controllo Granulare Accessi e Permessi Moduli Stile OpenSTAManager

export type PermissionLevel = 'denied' | 'read' | 'write';

export function getUserPermission(user: any, moduleKey: string): PermissionLevel {
  if (!user) return 'denied';
  if (user.ruolo === 'super_admin') return 'write';
  if (moduleKey === 'dashboard') return 'write';

  const userKey = user.id || user.email;
  const emailKey = user.email ? user.email.toLowerCase() : '';

  // 1. Controlla prima gli override specifici salvati nella Matrice Permessi
  let savedPermsStr = localStorage.getItem(`bluman_rbac_permissions_${userKey}`);
  if (!savedPermsStr && emailKey) {
    savedPermsStr = localStorage.getItem(`bluman_rbac_permissions_${emailKey}`);
  }

  if (savedPermsStr) {
    try {
      const perms = JSON.parse(savedPermsStr);
      if (Array.isArray(perms)) {
        const found = perms.find((p: any) => p.moduloChiave === moduleKey);
        if (found && found.livello) {
          return found.livello as PermissionLevel;
        }
      }
    } catch {}
  }

  // 2. Se non sono definiti override specifici, applica i permessi di default per ruolo
  if (user.ruolo === 'advisor') {
    if (['projects', 'clients', 'documents', 'calendar', 'retainers', 'invoices'].includes(moduleKey)) return 'write';
    if (['banks', 'primanota', 'scadenzario', 'library'].includes(moduleKey)) return 'read';
    if (['audit', 'settings', 'admin'].includes(moduleKey)) return 'denied';
    return 'write';
  }

  if (user.ruolo === 'collaboratore_interno' || user.ruolo === 'operator') {
    if (['projects', 'calendar'].includes(moduleKey)) return 'write';
    if (['clients', 'documents', 'library'].includes(moduleKey)) return 'read';
    return 'denied'; // Tutti gli altri moduli finanziari e di sistema rimangono bloccati
  }

  return 'write';
}
