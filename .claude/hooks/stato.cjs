#!/usr/bin/env node
// Hook SessionStart: all'avvio di ogni sessione mette nel contesto lo stato del
// lavoro, così Claude sa a che punto siamo senza che Fabio lo racconti.
//   - ramo, modifiche non committate, ultimi commit
//   - gli step aperti del PIANO ([ ] e [~]) delle sezioni di lavoro in testa
//     (fino al primo «## <numero>.»)
//   - le righe dell'ultimo giorno del DIARIO
// Preso dal metodo freelance (hook SessionStart di claude-base), portato dal
// pilota il 04/11/2026.
// Non blocca mai: qualunque errore = esce 0 senza scrivere niente.
const { execSync } = require("node:child_process");
const { readFileSync } = require("node:fs");

const sh = (c) => {
  try {
    return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
const leggi = (f) => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return "";
  }
};

try {
  const out = [];
  out.push("STATO DEL LAVORO (hook di avvio, .claude/hooks/stato.cjs)");
  out.push(`Ramo: ${sh("git rev-parse --abbrev-ref HEAD") || "?"}`);
  const modifiche = sh("git status --short").split("\n").filter(Boolean);
  out.push(modifiche.length ? `Modifiche non committate: ${modifiche.length}` : "Nessuna modifica non committata");
  const log = sh("git log --oneline -5");
  if (log) out.push("Ultimi commit:\n" + log);

  // PIANO: gli step aperti, con il titolo della sezione in cui stanno.
  const piano = leggi("PIANO.md").split("\n");
  const aperti = [];
  let sezione = "";
  for (const r of piano) {
    // Le sezioni di lavoro stanno in testa; se più in basso c'è il progetto
    // originale con sezioni numerate («## 0.», «## 1.»…), da lì in giù non è
    // lavoro in corso.
    if (/^## \d+\./.test(r)) break;
    if (r.startsWith("## ")) sezione = r.slice(3).trim();
    if (/^- \[( |~)\] /.test(r)) aperti.push(`  ${r.trim()}  [${sezione}]`);
  }
  if (aperti.length) out.push("Step aperti del PIANO:\n" + aperti.slice(0, 20).join("\n"));

  // DIARIO: l'ultimo giorno scritto (sezioni «## AAAA-MM-GG» o «## GG/MM/AAAA»).
  const diario = leggi("DIARIO.md").split("\n");
  let ultimo = -1;
  diario.forEach((r, i) => {
    if (/^## (\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/.test(r)) ultimo = i;
  });
  if (ultimo >= 0) {
    const righe = diario.slice(ultimo, ultimo + 12).filter(Boolean);
    out.push("Ultimo giorno del DIARIO:\n" + righe.map((r) => (r.length > 220 ? r.slice(0, 220) + "…" : r)).join("\n"));
  }
  process.stdout.write(out.join("\n\n") + "\n");
} catch {
  // mai bloccare l'avvio
}
process.exit(0);
