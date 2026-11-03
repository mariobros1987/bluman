# PASSAGGIO DI CONSEGNE — BLUMAN ERP
*Aggiornato: 27/09/2026 ore 17:10 | Sessione: Terminale Claude in c:\BluMan*

---

## PROGETTO
**BluMan** — ERP multitenant per studi commercialisti (Malta + Italia).
Stack: **Fastify + TypeScript + Prisma + PostgreSQL + React/Vite**
Path: `c:\BluMan\`
Git branch: `main` (allineato con origin/main)

---

## STATO REPOSITORY
Ultimo commit: `790b961b`
Tutti i test verdi. Nessuna modifica pendente.

### Ultimi commit rilevanti:
```
790b961b fix(progetti): revisione micro-voci/moduli/grafo
9ce51ce2 docs(agents): allinea mappa correzioni audit
b2b572dd feat(firme): multi-firma — parzialmente_firmato, anti ri-firma
2d4e09a4 fix(rbac): enforcement server matrice su documents e library (audit §01)
88ca8796 feat(kyc): SoggettoKyc creabile dallo studio (audit §02)
e61230d9 feat(canali): invio governato da matrice permessi
77e008e1 fix(fatture): IVA SDI coerente + PUT atomico (audit §04)
e4854c18 fix(firma-studio): sigillo HMAC + impronta file (audit §05)
06f35005 fix(kyc): modalità bozza + motivazioni rischio obbligatorie
```

---

## MODULI COMPLETATI

### KYC / AML (Malta FIAU-compliant)
- **K0**: Schema Prisma TenantComplianceSettings + ComplianceEvent (merkle-chain SHA-256)
- **K1**: Wizard antiriciclaggio + questionario UBO + scoring rischio cliente
- **K7/1-3**: Monitoraggio continuo (12/24/36 mesi per classe rischio) + gate spegnimento modulo
- **K8a**: AnomaliaKyc + MlroDecisionLog + PannelloAnomalie in scheda cliente
- **CDD Malta**: Schede Customer Due Diligence in Document Studio con Smart Tags

### Firme & Documenti
- Multi-firma: stato parzialmente_firmato, anti ri-firma, cronologia
- Sigillo HMAC su firma studio (evidenza legale)

### RBAC / Sicurezza
- Enforcement server matrice permessi su documents, library, communications
- /tenant/info riservato a advisor/super_admin
- Relay canali fail-closed senza EMAIL_RELAY_SECRET

### Workflow Contabili
- SDI Scartata, Solleciti (interessi mora D.Lgs. 231/2002), Insoluti, Riconciliazione bancaria
- IVA riepilogo SDI coerente (arrotondamento di gruppo)

### Altri
- Accessibilita WCAG (login, modale cambio password, scroll mobile tabelle)
- Anagrafica reale Tenant Bluecode Malta (C71668) con Smart Tags
- 3 template contrattuali Malta (EN + IT)

---

## DECISIONE INFRASTRUTTURA
- Vercel frontend: deploy manuale (webhook appesi, non investigare)
- Railway backend: ok
- Prossimo step: migrazione su VPS Register.it con Docker Compose (vedi PIANO_MIGRAZIONE_VPS.md)

---

## PROSSIMI PASSI PRIORITARI

### KYC (prima della migrazione VPS)
- **K8b**: Flusso STR / FIAU goAML export XML + PDF
- **K9**: Audit trail crittografico + reporting fascicolo per ispezioni FIAU

### Infrastruttura VPS (dopo KYC)
- Docker Compose: Fastify + PostgreSQL RLS + Redis + Nginx + SSL

### Audit residui
- L2 (accessibilita liste), B3 (breadcrumb), D3 (dashboard mobile)

---

## COMANDI UTILI
```
npm run dev
npx vitest run
git log --oneline -5
railway up
npx prisma migrate dev
npx prisma db seed
```

## FILE DI RIFERIMENTO
- ISTRUZIONI_PER_IA.md — guida per AI (LEGGERE SEMPRE)
- PIANO_DI_MIGLIORAMENTO.md — roadmap audit + features
- bluman-kyc-compliance-specifica-v0.2.md — spec KYC Malta
- PIANO_MIGRAZIONE_VPS.md — piano migrazione VPS
