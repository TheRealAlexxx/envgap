#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { scanDir, parseDotenv } = require('./scan.js');

// Built-ins that are set by the platform, not by you.
const IGNORE = new Set(['NODE_ENV', 'PATH', 'HOME', 'USER', 'PWD', 'SHELL', 'TERM', 'CI', 'TZ', 'LANG', 'TMPDIR', 'PORT_', 'HOSTNAME', 'DEBUG']);

function compare(used, example) {
  const names = [...used.keys()].filter((n) => !IGNORE.has(n)).sort();
  const undocumented = names.filter((n) => !example.declared.has(n) && !example.commented.has(n));
  const unused = [...example.declared, ...example.commented].filter((n) => !used.has(n)).sort();
  return { undocumented, unused };
}

const VERSION = require('./package.json').version;

const USAGE = `Usage: envgap [directory] [--json]

Find environment variables the code reads that .env.example does not
mention, and the reverse.

Arguments:
  directory        project root to scan (default: current directory)

Options:
  --json           machine-readable output
  -h, --help       show this help
  --version        show the version

Exit codes: 0 = in sync, 1 = undocumented variables, 2 = usage error.`;

function main(argv) {
  let json = false;
  let dir = null;
  for (const a of argv) {
    if (a === '-h' || a === '--help') { console.log(USAGE); return 0; }
    if (a === '--version') { console.log('envgap ' + VERSION); return 0; }
    if (a === '--json') { json = true; continue; }
    if (a.startsWith('-')) { console.error('unknown option: ' + a + ' (try --help)'); return 2; }
    if (dir !== null) { console.error('unexpected extra argument: ' + a); return 2; }
    dir = a;
  }
  dir = dir || '.';
  if (!fs.existsSync(dir)) { console.error('no such directory: ' + dir); return 2; }
  if (!fs.statSync(dir).isDirectory()) { console.error('not a directory: ' + dir); return 2; }
  const exFile = ['.env.example', '.env.sample', '.env.template'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (!exFile) { console.error('no .env.example, .env.sample or .env.template in ' + dir); return 2; }
  const used = scanDir(dir, dir);
  const { undocumented, unused } = compare(used, parseDotenv(fs.readFileSync(exFile, 'utf8')));
  if (json) {
    console.log(JSON.stringify({ file: path.basename(exFile), undocumented: undocumented.map((n) => ({ name: n, files: used.get(n) })), unused }, null, 2));
    return undocumented.length ? 1 : 0;
  }
  if (!undocumented.length && !unused.length) { console.log(path.basename(exFile) + ' matches the code'); return 0; }
  if (undocumented.length) {
    console.log('read by the code but missing from ' + path.basename(exFile) + ':');
    for (const n of undocumented) console.log('  ' + n.padEnd(28) + used.get(n).slice(0, 2).join(', ') + (used.get(n).length > 2 ? ' +' + (used.get(n).length - 2) : ''));
  }
  if (unused.length) {
    console.log((undocumented.length ? '\n' : '') + 'listed in ' + path.basename(exFile) + ' but never read:');
    for (const n of unused) console.log('  ' + n);
  }
  return undocumented.length ? 1 : 0;
}

// Set exitCode instead of calling process.exit: process.exit can cut off
// stdout writes still queued for a pipe, truncating large output at 64 KiB.
if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { compare, main };
