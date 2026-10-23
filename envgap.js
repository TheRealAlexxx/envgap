#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { scanDirDetailed, parseDotenv } = require('./scan.js');

// Built-ins that are set by the platform, not by you.
const IGNORE = new Set(['NODE_ENV', 'PATH', 'HOME', 'USER', 'PWD', 'SHELL', 'TERM', 'CI', 'TZ', 'LANG', 'TMPDIR', 'PORT_', 'HOSTNAME', 'DEBUG']);

// Variables CI providers set themselves (GitHub Actions default and runner
// variables). A name on this list is only ignored when the project's own
// example file does NOT mention it: if a project documents GITHUB_OUTPUT
// itself, that is its own configuration and stays reported.
const PROVIDER = new Set([
  'GITHUB_ACTION', 'GITHUB_ACTION_PATH', 'GITHUB_ACTION_REPOSITORY', 'GITHUB_ACTIONS', 'GITHUB_ACTOR', 'GITHUB_ACTOR_ID',
  'GITHUB_API_URL', 'GITHUB_BASE_REF', 'GITHUB_ENV', 'GITHUB_EVENT_NAME', 'GITHUB_EVENT_PATH', 'GITHUB_GRAPHQL_URL',
  'GITHUB_HEAD_REF', 'GITHUB_JOB', 'GITHUB_OUTPUT', 'GITHUB_PATH', 'GITHUB_REF', 'GITHUB_REF_NAME', 'GITHUB_REF_PROTECTED',
  'GITHUB_REF_TYPE', 'GITHUB_REPOSITORY', 'GITHUB_REPOSITORY_ID', 'GITHUB_REPOSITORY_OWNER', 'GITHUB_REPOSITORY_OWNER_ID',
  'GITHUB_RETENTION_DAYS', 'GITHUB_RUN_ATTEMPT', 'GITHUB_RUN_ID', 'GITHUB_RUN_NUMBER', 'GITHUB_SERVER_URL', 'GITHUB_SHA',
  'GITHUB_STEP_SUMMARY', 'GITHUB_TRIGGERING_ACTOR', 'GITHUB_WORKFLOW', 'GITHUB_WORKFLOW_REF', 'GITHUB_WORKFLOW_SHA',
  'GITHUB_WORKSPACE', 'RUNNER_ARCH', 'RUNNER_DEBUG', 'RUNNER_ENVIRONMENT', 'RUNNER_NAME', 'RUNNER_OS', 'RUNNER_TEMP',
  'RUNNER_TOOL_CACHE', 'ACTIONS_CACHE_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL',
  'ACTIONS_RESULTS_URL', 'ACTIONS_RUNTIME_TOKEN', 'ACTIONS_RUNTIME_URL',
]);

function compare(used, example) {
  const ignored = (n) => (IGNORE.has(n) || PROVIDER.has(n)) && !example.declared.has(n) && !example.commented.has(n);
  const names = [...used.keys()].filter((n) => !ignored(n)).sort();
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
  --exclude-tests  skip test, tests, __tests__ and spec directories
  --exclude NAME   also skip directories called NAME (repeatable)
  -h, --help       show this help
  --version        show the version

Exit codes: 0 = in sync, 1 = undocumented variables, 2 = usage error.`;

function main(argv) {
  let json = false;
  let dir = null;
  const opts = { excludeTests: false, exclude: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { console.log(USAGE); return 0; }
    if (a === '--version') { console.log('envgap ' + VERSION); return 0; }
    if (a === '--json') { json = true; continue; }
    if (a === '--exclude-tests') { opts.excludeTests = true; continue; }
    if (a === '--exclude' || a.startsWith('--exclude=')) {
      const name = a === '--exclude' ? argv[++i] : a.slice('--exclude='.length);
      if (!name) { console.error('--exclude needs a directory name'); return 2; }
      opts.exclude.push(name);
      continue;
    }
    if (a.startsWith('-')) { console.error('unknown option: ' + a + ' (try --help)'); return 2; }
    if (dir !== null) { console.error('unexpected extra argument: ' + a); return 2; }
    dir = a;
  }
  dir = dir || '.';
  if (!fs.existsSync(dir)) { console.error('no such directory: ' + dir); return 2; }
  if (!fs.statSync(dir).isDirectory()) { console.error('not a directory: ' + dir); return 2; }
  const exFile = ['.env.example', '.env.sample', '.env.template'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (!exFile) { console.error('no .env.example, .env.sample or .env.template in ' + dir); return 2; }
  const used = scanDirDetailed(dir, dir, opts);
  const { undocumented, unused } = compare(used, parseDotenv(fs.readFileSync(exFile, 'utf8')));
  const detail = (n) => {
    const rec = used.get(n);
    const reads = rec.reads || [];
    const defaulted = reads.length > 0 && reads.every((r) => r.defaulted);
    const kinds = new Set(reads.filter((r) => r.defaulted).map((r) => r.kind));
    const defaultKind = !defaulted ? null
      : kinds.has('empty') ? 'empty'
      : kinds.has('sentinel') ? 'sentinel'
      : kinds.has('expression') ? 'expression' : 'literal';
    return { name: n, files: rec.files || rec, defaulted, default_kind: defaultKind, shell_required: reads.some((r) => r.kind === 'required') };
  };
  if (json) {
    console.log(JSON.stringify({ file: path.basename(exFile), undocumented: undocumented.map(detail), unused }, null, 2));
    return undocumented.length ? 1 : 0;
  }
  if (!undocumented.length && !unused.length) { console.log(path.basename(exFile) + ' matches the code'); return 0; }
  if (undocumented.length) {
    console.log('read by the code but missing from ' + path.basename(exFile) + ':');
    for (const n of undocumented) {
      const d = detail(n);
      const note = d.shell_required ? '  # shell read fails when unset'
        : !d.defaulted ? ''
        : d.default_kind === 'empty' ? '  # default is an empty string'
        : d.default_kind === 'sentinel' ? "  # default is the variable's own name"
        : '  # has a default';
      console.log('  ' + n.padEnd(28) + ' ' + d.files.slice(0, 2).join(', ') + (d.files.length > 2 ? ' +' + (d.files.length - 2) : '') + note);
    }
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
