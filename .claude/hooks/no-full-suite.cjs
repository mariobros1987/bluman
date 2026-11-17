#!/usr/bin/env node
// Hook PreToolUse su Bash: blocca la suite intera in locale.
// La suite la lancia la CI sulla PR. Qui passano solo test mirati.
// Esce 0 = lascia passare. Esce 2 = blocca, con il motivo su stderr.
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = JSON.parse(input).tool_input?.command ?? "";
  } catch {
    process.exit(0);
  }
  const t = cmd.trim();
  // Forme che lanciano tutto: "pnpm test", "npm test", "vitest", "jest"
  // senza un percorso o un filtro dopo.
  const full =
    /^(pnpm|npm|yarn)\s+(run\s+)?test\s*$/.test(t) ||
    /^(pnpm|npm|yarn)\s+(run\s+)?test\s+--\s*$/.test(t) ||
    /^(npx\s+)?(vitest|jest)(\s+run)?\s*$/.test(t) ||
    /--filter\s+\S+\s+test\s*$/.test(t);
  if (full) {
    process.stderr.write(
      "Suite intera bloccata: la lancia la CI sulla PR. " +
        "In locale lancia solo i test dei file toccati, es. `pnpm vitest run test/<file>.test.ts`.\n"
    );
    process.exit(2);
  }
  process.exit(0);
});
