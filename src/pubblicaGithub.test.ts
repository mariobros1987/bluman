// `scripts/pubblica.sh` lanciato davvero, con due repo locali al posto di fork e titolare e un
// `gh` finto: il 28/11 una risposta vuota di GitHub («unexpected end of JSON input») ha chiuso
// la pubblicazione al primo colpo, e l'avviso non diceva né quale chiamata né con che errore.
import { describe, it, expect } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'pubblica.sh');

// Le prime GH_GUASTI chiamate `gh api` falliscono con GH_ERRORE, le altre rispondono «4» (il numero della PR).
const GH_FINTO = `#!/usr/bin/env bash
echo "$*" >> "$GH_REGISTRO"
if [[ "$1" == api ]] && (( $(grep -c '^api ' "$GH_REGISTRO") <= \${GH_GUASTI:-0} )); then
  echo "$GH_ERRORE" >&2
  exit 1
fi
[[ "$1" == api ]] && echo 4
exit 0
`;

interface Esito { stato: number | null; uscita: string; chiamate: string[] }

function pubblica(guasti: number, errore: string): Esito {
  const dir = mkdtempSync(join(tmpdir(), 'bluman-pubblica-'));
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@example.org', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };
  try {
    const lavoro = join(dir, 'lavoro');
    mkdirSync(join(dir, 'bin'));
    mkdirSync(lavoro);
    writeFileSync(join(dir, 'bin', 'gh'), GH_FINTO);
    chmodSync(join(dir, 'bin', 'gh'), 0o755);
    git(dir, 'init', '-q', '--bare', '-b', 'main', 'titolare.git');
    git(dir, 'init', '-q', '--bare', '-b', 'main', 'fork.git');
    git(lavoro, 'init', '-q', '-b', 'main');
    git(lavoro, 'remote', 'add', 'origin', join(dir, 'fork.git'));
    git(lavoro, 'remote', 'add', 'upstream', join(dir, 'titolare.git'));
    writeFileSync(join(lavoro, 'README.md'), 'prima\n');
    git(lavoro, 'add', '-A');
    git(lavoro, 'commit', '-q', '-m', 'già pubblicato');
    git(lavoro, 'push', '-q', 'upstream', 'main');
    // Il fork è avanti di un commit che porta una migrazione: è il caso del 28/11 (uscita 3, non si unisce).
    mkdirSync(join(lavoro, 'prisma', 'migrations', '20990101000000_prova'), { recursive: true });
    writeFileSync(join(lavoro, 'prisma', 'migrations', '20990101000000_prova', 'migration.sql'), '-- prova\n');
    git(lavoro, 'add', '-A');
    git(lavoro, 'commit', '-q', '-m', 'feat: da pubblicare');
    git(lavoro, 'push', '-q', 'origin', 'main');

    const registro = join(dir, 'gh.log');
    const r = spawnSync('bash', [SCRIPT, '--automatico'], {
      cwd: lavoro,
      encoding: 'utf8',
      // PUBBLICA_ATTESA=0: fra un tentativo e l'altro la prova non aspetta (niente tempo reale).
      env: { ...process.env, PATH: `${join(dir, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`, GH_REGISTRO: registro, GH_GUASTI: String(guasti), GH_ERRORE: errore, PUBBLICA_ATTESA: '0' },
    });
    const chiamate = existsSync(registro) ? readFileSync(registro, 'utf8').trim().split('\n') : [];
    return { stato: r.status, uscita: `${r.stdout}${r.stderr}`, chiamate };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(spawnSync('bash', ['-c', 'git --version']).status !== 0)('🔄 pubblica.sh — una risposta storta di GitHub non chiude la pubblicazione', () => {
  it('GitHub risponde vuoto una volta: la chiamata si ritenta e la pubblicazione arriva in fondo', () => {
    const { stato, uscita, chiamate } = pubblica(1, 'unexpected end of JSON input');
    expect(uscita).toContain('[pubblica] PR aggiornata: https://github.com/mariobros1987/bluman/pull/4');
    expect(uscita).toContain('[pubblica] NON unita: porta migrazioni');
    expect(stato).toBe(3);
    // Ricerca fallita, ricerca riuscita, aggiornamento: nessuna unione.
    expect(chiamate).toHaveLength(3);
    expect(chiamate.some((c) => c.startsWith('pr merge'))).toBe(false);
  });

  it('GitHub non risponde mai: rosso, e la riga [pubblica] dice quale chiamata e con che errore', () => {
    const { stato, uscita, chiamate } = pubblica(99, 'unexpected end of JSON input');
    expect(stato).toBe(1);
    expect(uscita).toMatch(/^\[pubblica\] GitHub non ha risposto a «cerca la PR aperta» \(tentativi: 3\): unexpected end of JSON input$/m);
    expect(chiamate).toHaveLength(3);
  });

  it('un rifiuto (HTTP 401) non si ritenta: riprovare non lo cambia', () => {
    const { stato, uscita, chiamate } = pubblica(99, 'gh: Bad credentials (HTTP 401)');
    expect(stato).toBe(1);
    expect(uscita).toContain('(tentativi: 1): gh: Bad credentials (HTTP 401)');
    expect(chiamate).toHaveLength(1);
  });

  it('il limite di richieste (HTTP 429) invece si ritenta', () => {
    const { stato, chiamate } = pubblica(2, 'gh: API rate limit exceeded (HTTP 429)');
    expect(stato).toBe(3);
    expect(chiamate).toHaveLength(4);
  });
});
