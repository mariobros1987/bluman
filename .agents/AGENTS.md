# AGENTS.md — BluMan (Bluecode Advisory Platform)

Regole di progetto lette automaticamente dall'AI ad ogni sessione.
**Non modificare senza discutere con il team.**

---

## 1. Cos'è BluMan

BluMan è una piattaforma SaaS **multi-tenant** per studi di consulenza patrimoniale (primo tenant: Bluecode Ltd, Malta). Gestisce l'intero ciclo di vita di un progetto di consulenza: preventivo -> engagement letter -> esecuzione -> fatturazione -> chiusura.

Il prototipo HTML di riferimento si trova in:
`c:\Users\casad\Downloads\bluman platform\260523 BluMan platform.html`

L'analisi di processo completa (specifica funzionale) si trova in:
`c:\Users\casad\Downloads\bluman platform\BluMan_analisi_di_processo.md`

---

## 2. Stack Tecnologico — RISPETTA SEMPRE QUESTO STACK

| Layer | Tecnologia | Note |
|---|---|---|
| Frontend | **React + Vite** | TypeScript, no Next.js |
| Backend | **Python + FastAPI** | Async, Pydantic v2 |
| Database | **PostgreSQL via Supabase** | Row-Level Security abilitata |
| Auth | **Supabase Auth** | JWT, app_metadata per ruoli/tenant |
| Storage | **Supabase Storage** | Per documenti clienti |
| Hosting backend | **Railway** (nixpacks.toml) | Come FantaAI |
| Firma digitale | **DocuSign** | python-docusign-esign |
| Email | **Postmark** | postmarker lib |
| CSS | **Vanilla CSS** | No Tailwind, no MUI, no styled-components |
| Colori | Dark mode, palette indigo #6366f1 | Come il prototipo HTML |
| Font | **DM Sans** da Google Fonts | Come il prototipo HTML |

**Non proporre mai tecnologie alternative a queste senza chiedere esplicitamente.**

---

## 3. Architettura Multi-Tenant — REGOLA FONDAMENTALE

- **Ogni tabella del DB porta tenant_id** (tranne tenant e user quando is_super_admin = true).
- Il backend usa **sempre** il tenant_id estratto dal JWT per filtrare i dati — mai fidarsi di tenant_id passato dal client nel body.
- La dependency FastAPI get_current_user legge tenant_id da app_metadata del JWT Supabase.
- Il **Super Admin** non ha tenant_id: ha is_super_admin = true in app_metadata e vede tutti i tenant.
- **Row-Level Security (RLS)** e abilitata su Supabase per ogni tabella. Il backend usa service_role key (bypassa RLS) e applica il filtro tenant a livello applicativo nelle query.

---

## 4. Flusso di Business — NON CAMBIARE SENZA CONSENSO

PREVENTIVO (bozza -> inviato -> accettato)
    [su accettazione: azione automatica del sistema]
ENGAGEMENT LETTER generata + PROGETTO creato (stato: pre_project)
    [cliente firma su DocuSign]
PROGETTO passa a in_progress
    -> ESECUZIONE: team lavora sulle micro-voci, consuntiva ore, carica documenti
    -> FATTURAZIONE: per modulo completato / % avanzamento / milestone libera
    -> CHIUSURA: tutti i moduli completed -> progetto completed -> archiviato

### Entita separate: Preventivo != Progetto
- preventivo e progetto sono **tabelle distinte** — non usare solo lo stato pre_project per rappresentare un preventivo.
- Il progetto nasce solo quando il preventivo e **accettato**.
- progetto.preventivo_id referenzia il preventivo di origine.

---

## 5. Modello Dati — Schema DB (PostgreSQL/Supabase)

Tabelle:
  tenant, user, cliente,
  modulo_template, microvoce_template,
  modulo_dipendenza_template,
  preventivo, engagement_letter,
  progetto, modulo_progetto, microvoce_progetto,
  modulo_progetto_dipendenza,
  documento, fattura, fattura_riga,
  evento_calendario, notifica

Regole schema:
- Ogni PK e UUID (gen_random_uuid()), non serial integer.
- Ogni tabella ha created_at TIMESTAMPTZ DEFAULT now() e updated_at TIMESTAMPTZ.
- tenant_id UUID NOT NULL REFERENCES tenant(id) su ogni tabella (tranne tenant, user quando super_admin).
- Enum PostgreSQL per stati (non stringhe libere).

### Stati micro-voce (enum stato_microvoce)
  pending | attesa_dipendenza | active | at_risk | delayed | blocked | done

- attesa_dipendenza = blocco strutturale (modulo precedente non completato)
- at_risk = calcolato automaticamente dal sistema quando ore_consuntivate > ore_preventivate
- delayed e blocked = inseriti manualmente con nota obbligatoria

### Fattura riga — tre tipi
1. modulo_completo
2. modulo_parziale (con campo percentuale)
3. milestone_libera (non referenzia modulo)

---

## 6. Struttura del Progetto

  c:\BluMan\
  backend\
    app\
      main.py
      config.py
      api\         (auth, clienti, preventivi, progetti, moduli, microVoci, fatture, documenti, notifiche, libreria, superadmin)
      models\      (Pydantic schemas)
      db\
        client.py  (Supabase singleton service_role)
        auth.py    (JWT decode + dependencies)
      services\
        stati.py       (motore calcolo stati)
        docusign.py    (integrazione DocuSign)
        email.py       (Postmark)
        preventivo.py  (logica accettazione -> crea progetto)
    migrations\  (001_initial.sql, 002_..., numerati)
    nixpacks.toml
    requirements.txt
    .env (NON committare mai)
  frontend\
    src\
      pages\    (Dashboard, Progetti, Clienti, Calendario, Libreria, Impostazioni, SuperAdmin)
      portale\  (portale cliente /portale/*)
      components\
        ui\      (Button, Badge, Card, Modal)
        layout\  (Sidebar, Topbar, Layout)
        shared\  (ProgressBar, StatusBadge, AvatarGroup)
      hooks\   (useAuth, useProjects, useClients)
      api\     (funzioni fetch verso FastAPI)
      stores\  (Zustand stores)
      assets\

---

## 7. Convenzioni di Codice

### Backend (Python/FastAPI)
- Async ovunque: tutte le route e funzioni DB sono async def.
- Pydantic v2: usare model_validator, field_validator.
- Nomi: snake_case per variabili/funzioni, PascalCase per classi Pydantic.
- Errori: HTTPException con status code precisi. Messaggi in italiano.
- Tenant isolation: ogni funzione DB riceve tenant_id come parametro esplicito.
- Response models: definire sempre response_model= nelle route.
- Migrations: numerati, MAI modificare un migration gia applicato.

### Frontend (React/TypeScript)
- TypeScript strict: niente any, tipi espliciti ovunque.
- Componenti funzionali con hooks, niente class components.
- CSS: file .css separato per ogni componente.
- Design system: usare variabili CSS da index.css, niente colori hardcoded.
- API calls: tutte in src/api/, niente fetch diretto nei componenti.
- Nomi file: PascalCase per componenti, camelCase per utils/hooks.

---

## 8. Design — Regole Estetiche

- Dark mode: background #0f1117, sidebar #161822, card #1e2030
- Accent: indigo #6366f1 (primary), verde #10b981 (success), ambra #f59e0b (warning), rosso #ef4444 (blocked)
- Font: DM Sans (Google Fonts) — weights 300, 400, 500, 600
- Border radius: 8px small, 12px card, 16px modal
- Il prototipo HTML e il riferimento visivo — replicare fedelmente l'estetica
- Transizioni 0.15s su hover

---

## 9. Sicurezza — Regole Assolute

- MAI esporre SUPABASE_SERVICE_KEY al frontend.
- MAI fare query senza tenant_id filter lato backend.
- MAI fidarsi di tenant_id passato dal client nel body/params.
- MAI committare file .env.
- DocuSign private key: sempre come file esterno da variabile d'ambiente.

---

## 10. Ordine di Sviluppo (MVP)

- [x] Struttura progetto (cartelle, config, nixpacks)
- [x] Migrations SQL — schema DB completo (001_initial.sql)
- [x] config.py, db/client.py, db/auth.py (middleware JWT + tenant isolation)
- [x] main.py (FastAPI app con tutti i router)
- [x] services/preventivo.py — logica accettazione (crea progetto + moduli + dipendenze + EL)
- [x] services/docusign.py — integrazione DocuSign (JWT auth, envelope, signing URL)
- [x] api/preventivi.py — CRUD + /invia + /accetta + /rifiuta
- [x] api/progetti.py — lista/dettaglio/update + webhook DocuSign firma
- [x] Auth multi-tenant (Supabase Auth + ruoli in app_metadata) — api/auth.py
- [x] API Clienti (CRUD) — api/clienti.py
- [x] API Libreria Moduli (CRUD template + dipendenze) — api/libreria.py
- [x] API Moduli Progetto (stato, team, avanzamento) — api/moduli.py
- [x] API Micro-voci (consuntivazione ore, cambio stato con nota) — api/micro_voci.py
- [x] Motore stati (at_risk automatico, propagazione delayed/blocked) — services/stati.py
- [x] API Fatture (3 tipi riga) — api/fatture.py
- [x] API Documenti (upload Supabase Storage) — api/documenti.py
- [x] Super Admin — api/superadmin.py
- [ ] Frontend React — Layout + Auth
- [ ] Frontend — Dashboard, Progetti, Wizard, Libreria
- [ ] Portale cliente (/portale)
- [x] Notifiche email (Postmark) — services/email.py

## V2 (dopo MVP)
- [ ] Logica blocco/sblocco automatico grafo dipendenze
- [ ] Portale cliente: firma digitale in-app
- [ ] Calendario condiviso team

---

## 11. Riferimenti Chiave

- Analisi di processo: c:\Users\casad\Downloads\bluman platform\BluMan_analisi_di_processo.md
- Prototipo UI: c:\Users\casad\Downloads\bluman platform\260523 BluMan platform.html
- Schema DB: vedere paragrafo 14 del documento di analisi
