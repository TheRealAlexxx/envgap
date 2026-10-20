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

function main(argv) {
  const json = argv.includes('--json');
  const args = argv.filter((a) => !a.startsWith('--'));
  const dir = args[0] || '.';
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

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { compare, main };
