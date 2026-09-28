# 13 · KYC / AML (Malta)

## 👤 Cosa fa e come si usa
Il modulo **KYC/AML** gestisce l'adeguata verifica del cliente secondo l'impianto **Malta
(FIAU/MFSA)**. Si attiva per-studio; in anagrafica cliente compare la scheda **Compliance**.
- **Fascicolo KYC** del cliente: raccolta documenti, questionario UBO, **valutazione del rischio**,
  scadenze di rinnovo.
- **Anomalie / segnalazioni interne** e **decisioni MLRO**; da qui nasce l'eventuale **STR** (dossier
  goAML per la FIAU).
- **Monitoraggio continuo**: rivalutazione periodica per classe di rischio.
- Le impostazioni di compliance (profilo regolatorio, MLRO) stanno in **Impostazioni** (§16).

## 📐 Calcoli & logica
- **Rischio a 4 pilastri** (spec §6) calcolato dal motore `kycEngine` (albero §4.1); scadenze di
  monitoraggio differenziate per classe (es. 12/24/36 mesi). Ogni punteggio/blocco è **spiegabile**
  (§12): le 4 motivazioni di rischio sono obbligatorie.
- **Gate operativo (modalità bozza)**: l'approvazione KYC è bloccata **solo se manca il PROFILO
  REGOLATORIO**; la nomina **MLRO non è bloccante** (l'advisor/super_admin è già autorità di
  approvazione, decisione titolare 27/09).
- **Ritenzione 5 anni** (K9) con audit trail crittografico (`ComplianceEvent` a **merkle-chain**
  SHA-256, append-only).
- `SoggettoKyc` creabile **lato studio** (non solo da portale), per non lasciare la catena
  screening/report a «n/d».

## 🔗 Collegamenti
- **Clienti** (§02): scheda Compliance / fascicolo.
- **Fatture** (§05): l'emissione può essere vincolata al gate KYC.
- **Portale** (§12): il cliente compila i form (UBO, dati) del fascicolo.
- **Impostazioni** (§16): profilo regolatorio e MLRO.

## ⚠️ Stati limite & errori
- Approvazione senza profilo regolatorio → bloccata (gate bozza).
- Motivazioni di rischio mancanti → non si conclude la valutazione.
- Il modulo è disattivabile per-studio (§17) con 403 sulle rotte se spento.

## 🔧 Nota tecnica
- Rotte: `src/routes/kyc.ts`, `compliance.ts`. Servizi: `services/complianceService.ts`,
  `domain/kycEngine.ts`. Modelli: `TenantComplianceSettings`, `ComplianceEvent` (merkle-chain),
  `FascicoloKyc`/`KycCase`, `SoggettoKyc`, `AnomaliaKyc`, `MlroDecisionLog`, `DocumentoKyc`.
- Frontend: scheda Compliance in `AnagraficaErpModal`, `components/kyc/` (`PannelloSoggettoKyc`,
  `PannelloTitolariEffettivi`, `PannelloRetention`, anomalie), `TabCompliance`.
- Fonti: `bluman-kyc-compliance-specifica-v0.2.md`, `AUDIT_2026-09-27/02-kyc-aml.md`, `.agents/AGENTS.md`.
