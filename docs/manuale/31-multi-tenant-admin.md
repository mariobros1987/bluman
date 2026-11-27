# 31 · Multi-Tenant Admin

## 👤 Cosa fa e come si usa
**Multi-Tenant Admin** (`/admin/tenants`) è il pannello del **super admin**: gestisce gli studi presenti sulla piattaforma e le loro licenze. Gli altri ruoli non lo vedono.

**Registrare un nuovo studio**: con **Registra Nuovo Tenant Studio** si inseriscono ragione sociale, giurisdizione, partita IVA, nome ed email del responsabile, piano e durata della licenza. Al termine compaiono le credenziali del responsabile.

**Azioni su ogni studio**

| Azione | Effetto |
|---|---|
| **Entra** | Apre lo studio come studio attivo, in Document Studio |
| **Link & Password** | Mostra il link di accesso e l'email del responsabile; permette di rigenerare e inviare le credenziali |
| **Tempo** | Proroga la licenza di 30, 90, 180 o 365 giorni, oppure imposta una data precisa |
| **KYC ON/OFF** | Concede o revoca allo studio il modulo Compliance/KYC |
| **Sospendi / Riattiva** | Blocca o ripristina l'accesso allo studio |
| **Archivia / Ripristina** | Blocca l'accesso agli utenti conservando tutti i dati; è un'operazione reversibile |
| **Elimina definitivamente** | Disponibile solo per gli studi archiviati |

La scheda **Backup off-site** gestisce la copia di sicurezza esterna alla piattaforma.

## 📐 Calcoli & logica
- **La password del responsabile si vede una sola volta.** Non è più leggibile in seguito: se viene persa se ne genera una nuova, e quella precedente smette subito di funzionare.
- Una proroga della licenza riporta lo studio allo stato **attivo**.
- La scadenza è evidenziata quando mancano 15 giorni o meno.
- Il token del backup si può sostituire o disattivare, ma non rileggere.

## 🔗 Collegamenti
- **Impostazioni** (§16): al primo accesso il responsabile completa i dati dello studio e invita i collaboratori.
- **KYC / AML** (§13), **Permessi** (§17).

## ⚠️ Stati limite & errori
- Se l'elenco degli studi non è disponibile, la pagina lo dichiara e propone **Riprova**: i contatori a zero non significano che gli studi non esistano.

- L'eliminazione definitiva è **irreversibile**: cancella utenti, clienti, progetti, fatture, documenti e archivi dello studio.

## 🔧 Nota tecnica
- Frontend: `pages/SuperAdminPage.tsx`, `components/admin/PannelloBackupOffSite.tsx`.
- Rotte: `/admin/*` (guardia `soloSuperAdmin`, fuori matrice). Scheda riservata al super admin.
