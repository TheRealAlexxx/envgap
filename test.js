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
