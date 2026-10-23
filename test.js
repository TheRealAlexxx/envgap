'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const { usedIn, parseDotenv, scanDir } = require('./scan.js');
const { compare } = require('./envgap.js');

test('finds names across languages', () => {
  assert.deepStrictEqual([...usedIn('const a = process.env.API_KEY; const b = process.env["DB_URL"]; import.meta.env.VITE_X', '.js')].sort(), ['API_KEY', 'DB_URL', 'VITE_X']);
  assert.deepStrictEqual([...usedIn('os.environ.get("A_B"); os.environ["C_D"]; os.getenv("E_F")', '.py')].sort(), ['A_B', 'C_D', 'E_F']);
  assert.deepStrictEqual([...usedIn('os.Getenv("GO_VAR")', '.go')], ['GO_VAR']);
  assert.deepStrictEqual([...usedIn('std::env::var("RS_VAR")', '.rs')], ['RS_VAR']);
  assert.deepStrictEqual([...usedIn('ENV.fetch("RB_VAR")', '.rb')], ['RB_VAR']);
});
test('shell expansions only count in .sh files', () => {
  assert.deepStrictEqual([...usedIn('echo "$DEPLOY_HOST ${TOKEN_X}"', '.sh')].sort(), ['DEPLOY_HOST', 'TOKEN_X']);
  assert.deepStrictEqual([...usedIn('const s = `${FOOBAR}`', '.js')], []);
});
test('lowercase names are ignored', () => {
  assert.deepStrictEqual([...usedIn('process.env.debug_x', '.js')], []);
});
test('dotenv parsing', () => {
  const r = parseDotenv('A=1\nexport B=2\n# C=3\n# just a comment\n\nd=4\n');
  assert.deepStrictEqual([...r.declared].sort(), ['A', 'B', 'd']);
  assert.deepStrictEqual([...r.commented], ['C']);
});
test('compare ignores platform vars and counts commented ones as documented', () => {
  const used = new Map([['API_KEY', ['a.js']], ['NODE_ENV', ['a.js']], ['OPT', ['b.js']], ['NEW_ONE', ['c.js']]]);
  const r = compare(used, parseDotenv('API_KEY=\n# OPT=\nOLD=\n'));
  assert.deepStrictEqual(r, { undocumented: ['NEW_ONE'], unused: ['OLD'] });
});
function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-'));
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); }
  return dir;
}
test('scanDir skips node_modules and records files', () => {
  const dir = project({ 'src/a.js': 'process.env.SEEN', 'node_modules/x/i.js': 'process.env.HIDDEN' });
  const m = scanDir(dir, dir);
  assert.deepStrictEqual([...m.keys()], ['SEEN']);
  assert.deepStrictEqual(m.get('SEEN'), [path.join('src', 'a.js')]);
});
test('CLI exit codes', () => {
  const bin = path.join(__dirname, 'envgap.js');
  const ok = project({ '.env.example': 'A=\n', 'x.js': 'process.env.A' });
  assert.strictEqual(spawnSync('node', [bin, ok]).status, 0);
  const bad = project({ '.env.example': 'A=\n', 'x.js': 'process.env.A + process.env.B' });
  const r = spawnSync('node', [bin, bad], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /B\s+x\.js/);
  assert.strictEqual(spawnSync('node', [bin, project({ 'x.js': '' })]).status, 2);
  assert.deepStrictEqual(JSON.parse(spawnSync('node', [bin, bad, '--json'], { encoding: 'utf8' }).stdout).undocumented.map((u) => u.name), ['B']);
});
test('CLI argument handling', () => {
  const bin = path.join(__dirname, 'envgap.js');
  const help = spawnSync('node', [bin, '--help'], { encoding: 'utf8' });
  assert.strictEqual(help.status, 0);
  assert.match(help.stdout, /Usage: envgap/);
  assert.match(help.stdout, /--json/);
  const short = spawnSync('node', [bin, '-h'], { encoding: 'utf8' });
  assert.strictEqual(short.status, 0);
  assert.match(short.stdout, /Usage: envgap/);
  const ver = spawnSync('node', [bin, '--version'], { encoding: 'utf8' });
  assert.strictEqual(ver.status, 0);
  assert.match(ver.stdout, /^envgap \d+\.\d+\.\d+/);
  const bogus = spawnSync('node', [bin, '--bogus'], { encoding: 'utf8' });
  assert.strictEqual(bogus.status, 2);
  assert.match(bogus.stderr, /unknown option: --bogus/);
  const missing = spawnSync('node', [bin, '/definitely/not/a/dir'], { encoding: 'utf8' });
  assert.strictEqual(missing.status, 2);
  assert.match(missing.stderr, /no such directory/);
  const fileArg = spawnSync('node', [bin, path.join(__dirname, 'envgap.js')], { encoding: 'utf8' });
  assert.strictEqual(fileArg.status, 2);
  assert.match(fileArg.stderr, /not a directory/);
  const extra = spawnSync('node', [bin, '.', '.'], { encoding: 'utf8' });
  assert.strictEqual(extra.status, 2);
  assert.match(extra.stderr, /unexpected extra argument/);
});
// POSIX-only: pipes the CLI through sh with a slow reader.
test('piped --json output larger than 64 KiB is not truncated', { skip: process.platform === 'win32' }, () => {
  const bin = path.join(__dirname, 'envgap.js');
  const files = { '.env.example': 'EXISTING_VAR=\n' };
  for (let i = 0; i < 600; i++) {
    const n = String(i).padStart(4, '0');
    files['src/f' + n + '.js'] = `const a = process.env.UNDOC_A_${n};\nconst b = process.env.UNDOC_B_${n};`;
  }
  const dir = project(files);
  // Pipe through a slow reader so the 64 KiB pipe buffer fills while the
  // writer still has output queued; process.exit would discard the rest.
  // (A fast reader makes the old bug flaky instead of deterministic.)
  const cmd = `node ${JSON.stringify(bin)} ${JSON.stringify(dir)} --json | (sleep 0.2; cat)`;
  const piped = spawnSync('sh', ['-c', cmd], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.ok(piped.stdout.length > 65536, `expected over 64 KiB of JSON, got ${piped.stdout.length}`);
  const parsed = JSON.parse(piped.stdout); // a truncated stream fails here
  assert.strictEqual(parsed.undocumented.length, 1200);
  // The piped bytes must equal what a file redirect gets.
  const out = path.join(dir, 'out.json');
  spawnSync('node', [bin, dir, '--json'], { stdio: ['ignore', fs.openSync(out, 'w'), 'inherit'] });
  assert.strictEqual(piped.stdout, fs.readFileSync(out, 'utf8'));
});
const { usedInReads, scanDirDetailed } = require('./scan.js');

test('read defaults are detected per language', () => {
  const kinds = (text, ext) => {
    const out = {};
    for (const [n, reads] of usedInReads(text, ext)) out[n] = reads;
    return out;
  };
  // node fallbacks
  assert.deepStrictEqual(kinds('process.env.PORT || "3000"', '.js').PORT, [{ defaulted: true, kind: 'literal' }]);
  assert.deepStrictEqual(kinds('process.env.EMPTY_OK ?? ""', '.js').EMPTY_OK, [{ defaulted: true, kind: 'empty' }]);
  assert.deepStrictEqual(kinds('process.env["TIMEOUT"] || \'30\'', '.js').TIMEOUT, [{ defaulted: true, kind: 'literal' }]);
  assert.deepStrictEqual(kinds('import.meta.env.VITE_API || "/api"', '.ts').VITE_API, [{ defaulted: true, kind: 'literal' }]);
  // python defaults: literal, empty, sentinel self-name, bare
  assert.deepStrictEqual(kinds('os.getenv("LOG_FORMAT", "")', '.py').LOG_FORMAT, [{ defaulted: true, kind: 'empty' }]);
  assert.deepStrictEqual(kinds('os.environ.get("BILLING_API_URL", "BILLING_API_URL")', '.py').BILLING_API_URL, [{ defaulted: true, kind: 'sentinel' }]);
  assert.deepStrictEqual(kinds("os.environ.get('WORKERS', 4)", '.py').WORKERS, [{ defaulted: true, kind: 'expression' }]);
  assert.deepStrictEqual(kinds('os.environ["SECRET_KEY"]', '.py').SECRET_KEY, [{ defaulted: false, kind: null }]);
  // ruby
  assert.deepStrictEqual(kinds('ENV.fetch("REDIS_URL", "redis://localhost")', '.rb').REDIS_URL, [{ defaulted: true, kind: 'literal' }]);
  assert.deepStrictEqual(kinds('ENV.fetch("MANDATORY")', '.rb').MANDATORY, [{ defaulted: false, kind: null }]);
  // a defaulted read is not also counted as bare
  assert.strictEqual(kinds('process.env.PORT || "3000"', '.js').PORT.length, 1);
});
test('shell expansions classify defaults and required reads', () => {
  const r = usedInReads('PORT=${PORT:-8080}\nEMPTY=${MAYBE:-}\nW=${CELERY_MAX_WORKERS:-$CORES}\n: ${DATABASE_URL:?must be set}\necho "$PLAIN"', '.sh');
  assert.deepStrictEqual(r.get('PORT'), [{ defaulted: true, kind: 'literal' }]);
  assert.deepStrictEqual(r.get('MAYBE'), [{ defaulted: true, kind: 'empty' }]);
  assert.deepStrictEqual(r.get('CELERY_MAX_WORKERS'), [{ defaulted: true, kind: 'expression' }]);
  assert.deepStrictEqual(r.get('DATABASE_URL'), [{ defaulted: false, kind: 'required' }]);
  assert.deepStrictEqual(r.get('PLAIN'), [{ defaulted: false, kind: null }]);
});
test('documented CI provider variables are ignored unless the project names them', () => {
  const used = new Map([
    ['GITHUB_OUTPUT', ['ci.yml.js']],
    ['ACTIONS_ID_TOKEN_REQUEST_URL', ['tests/utils/trusted-sources.ts']],
    ['GITHUB_CLIENT_ID', ['config/auth.js']],
    ['REAL_MISSING', ['src/app.js']],
  ]);
  const r = compare(used, parseDotenv(''));
  // provider-set names are dropped; a user-defined GITHUB_* name is NOT a provider name
  assert.deepStrictEqual(r.undocumented, ['GITHUB_CLIENT_ID', 'REAL_MISSING']);
  // a provider name the project documents itself stays visible (here: documented, so no finding)
  const r2 = compare(used, parseDotenv('GITHUB_OUTPUT=\n'));
  assert.deepStrictEqual(r2.undocumented, ['GITHUB_CLIENT_ID', 'REAL_MISSING']);
  assert.deepStrictEqual(r2.unused, []);
});
test('vendored and minified assets are skipped', () => {
  const dir = project({
    '.env.example': '',
    'src/real.js': 'process.env.REAL_VAR',
    'public/vs/editor/editor.main.js': 'process.env.VSCODE_CWD',
    'assets/vendor.min.js': 'process.env.MIN_VAR',
    'assets/app.bundle.js': 'process.env.BUNDLE_VAR',
  });
  assert.deepStrictEqual([...scanDirDetailed(dir, dir).keys()], ['REAL_VAR']);
});
test('test directories are scanned by default, skipped with excludeTests', () => {
  const dir = project({
    '.env.example': '',
    'src/a.js': 'process.env.APP_VAR',
    'tests/a.test.js': 'process.env.TEST_ONLY_VAR',
    '.agents/skills/x/t.sh': 'echo "$AGENT_VAR"',
  });
  assert.deepStrictEqual([...scanDirDetailed(dir, dir).keys()].sort(), ['AGENT_VAR', 'APP_VAR', 'TEST_ONLY_VAR']);
  assert.deepStrictEqual([...scanDirDetailed(dir, dir, { excludeTests: true }).keys()].sort(), ['AGENT_VAR', 'APP_VAR']);
  assert.deepStrictEqual([...scanDirDetailed(dir, dir, { exclude: ['.agents'] }).keys()].sort(), ['APP_VAR', 'TEST_ONLY_VAR']);
});
test('CLI --exclude-tests and --exclude filter the scan', () => {
  const bin = path.join(__dirname, 'envgap.js');
  const dir = project({
    '.env.example': '',
    'src/a.js': 'process.env.APP_VAR',
    'tests/a.test.js': 'process.env.TEST_ONLY_VAR',
    'generated/g.js': 'process.env.GENERATED_VAR',
  });
  const names = (args) => JSON.parse(spawnSync('node', [bin, dir, '--json', ...args], { encoding: 'utf8' }).stdout).undocumented.map((u) => u.name);
  assert.deepStrictEqual(names([]), ['APP_VAR', 'GENERATED_VAR', 'TEST_ONLY_VAR']);
  assert.deepStrictEqual(names(['--exclude-tests']), ['APP_VAR', 'GENERATED_VAR']);
  assert.deepStrictEqual(names(['--exclude', 'generated']), ['APP_VAR', 'TEST_ONLY_VAR']);
  assert.deepStrictEqual(names(['--exclude=generated', '--exclude-tests']), ['APP_VAR']);
  const bad = spawnSync('node', [bin, dir, '--exclude'], { encoding: 'utf8' });
  assert.strictEqual(bad.status, 2);
});
test('defaulted reads are reported in JSON and text output', () => {
  const bin = path.join(__dirname, 'envgap.js');
  const dir = project({
    '.env.example': '',
    'src/a.py': 'os.getenv("LOG_FORMAT", "")\nos.environ["SECRET_KEY"]\nos.environ.get("BILLING_API_URL", "BILLING_API_URL")',
    'entry.sh': ': ${DATABASE_URL:?must be set}',
  });
  const j = JSON.parse(spawnSync('node', [bin, dir, '--json'], { encoding: 'utf8' }).stdout);
  const byName = Object.fromEntries(j.undocumented.map((u) => [u.name, u]));
  assert.deepStrictEqual(byName.LOG_FORMAT, { name: 'LOG_FORMAT', files: ['src/a.py'], defaulted: true, default_kind: 'empty', shell_required: false });
  assert.deepStrictEqual(byName.SECRET_KEY, { name: 'SECRET_KEY', files: ['src/a.py'], defaulted: false, default_kind: null, shell_required: false });
  assert.deepStrictEqual(byName.BILLING_API_URL.default_kind, 'sentinel');
  assert.strictEqual(byName.DATABASE_URL.shell_required, true);
  const text = spawnSync('node', [bin, dir], { encoding: 'utf8' }).stdout;
  assert.match(text, /LOG_FORMAT\s+src\/a\.py\s+# default is an empty string/);
  assert.match(text, /BILLING_API_URL\s+src\/a\.py\s+# default is the variable's own name/);
  assert.match(text, /DATABASE_URL\s+entry\.sh\s+# shell read fails when unset/);
  assert.doesNotMatch(text, /SECRET_KEY.*#/);
});
test('None and nil defaults count as bare reads', () => {
  assert.deepStrictEqual(usedInReads('os.getenv("LOG_LEVEL", None)', '.py').get('LOG_LEVEL'), [{ defaulted: false, kind: null }]);
  assert.deepStrictEqual(usedInReads("os.environ.get('LOG_LEVEL', None)", '.py').get('LOG_LEVEL'), [{ defaulted: false, kind: null }]);
  assert.deepStrictEqual(usedInReads('ENV.fetch("OPTIONAL_FLAG", nil)', '.rb').get('OPTIONAL_FLAG'), [{ defaulted: false, kind: null }]);
  // a None default must not make the variable look defaulted in CLI output either
  const bin = path.join(__dirname, 'envgap.js');
  const dir = project({ '.env.example': '', 'a.py': 'os.getenv("LOG_LEVEL", None)' });
  const j = JSON.parse(spawnSync('node', [bin, dir, '--json'], { encoding: 'utf8' }).stdout);
  assert.strictEqual(j.undocumented[0].defaulted, false);
  assert.strictEqual(j.undocumented[0].default_kind, null);
});
test('long variable names do not run into the file list', () => {
  const bin = path.join(__dirname, 'envgap.js');
  const dir = project({ '.env.example': '', 'a.js': 'process.env.AIOHTTP_CLIENT_ALLOW_REDIRECTS' });
  const text = spawnSync('node', [bin, dir], { encoding: 'utf8' }).stdout;
  assert.match(text, /AIOHTTP_CLIENT_ALLOW_REDIRECTS +a\.js/);
  assert.doesNotMatch(text, /REDIRECTSa\.js/);
});
