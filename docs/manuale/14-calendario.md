# 14 · Calendario & scadenze attività

## 👤 Cosa fa e come si usa
Il **Calendario Condiviso** (`/calendar`) è lo scadenzario delle attività dello studio: vista **mese**
o **agenda** con i compiti e le scadenze reali dal database.
- Gli eventi nascono dalle **micro-voci** (scadenze/attività) e da compiti creati a mano; ogni evento è
  legato a progetto/micro-voce e a un assegnatario.
- Un **cron worker** genera i promemoria delle scadenze ricorrenti (es. UBO, marchi) e le notifiche.

## 📐 Calcoli & logica
- **Visibilità per ruolo**: cosa vede ciascun utente nel calendario dipende dai permessi (un modulo
  tolto all'utente non riappare come evento); la logica sta in `calendarioVisibilita` (puro) +
  `calendarioEventi` (che interroga il DB).
- Un evento che appartiene a più contesti (es. rinnovo che tocca più schede) si mostra **una volta**,
  non moltiplicato.

## 🔗 Collegamenti
- **Progetti** (§01): le scadenze delle micro-voci compaiono qui.
- **Comunicazioni/Notifiche** (§15): i promemoria escono via canali/notifiche.
- **KYC** (§13): le scadenze di monitoraggio/rinnovo.

## ⚠️ Stati limite & errori
- Attività non ancora salvata a database → non agganciabile al fascicolo (messaggio esplicito).
- Empty state sincero se non ci sono eventi nel periodo.

## 🔧 Nota tecnica
- Servizi: `src/services/calendarioEventi.ts`, `src/util/calendarioVisibilita.ts`. Cron:
  worker scadenze (servizio `cron-notifiche`). Rotte calendario/eventi.
- Frontend: `pages/CalendarPage.tsx`, `components/calendar/`.
- Schema: `EventoCalendario` (FK a progetto/modulo/micro-voce).
- Fonti: `.agents/AGENTS.md`.
