'use strict';
// Find environment variable names a codebase reads, and the ones a dotenv file declares.
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'vendor', '__pycache__', '.venv', 'target']);
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec']);
const EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.php', '.sh']);
// Bundled/minified assets (monaco editor builds etc.) read their own runtime vars.
const SKIP_FILE = /\.(min|bundle)\.js$/;
const SKIP_PATH = /(^|\/)public\/vs\//;

// kind: 'empty' | 'sentinel' | 'literal' | 'expression' | 'required' | null
function defaultKind(name, inner) {
  if (inner === '') return 'empty';
  if (inner === name) return 'sentinel'; // default is the variable's own name: a placeholder, not a value
  return 'literal';
}

function spans(re, text) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) out.push(m);
  return out;
}
const inSpans = (idx, list) => list.some((m) => idx >= m.index && idx < m.index + m[0].length);

// Map name -> [{ defaulted, kind }]. One record per read site.
function usedInReads(text, ext) {
  const out = new Map();
  const add = (name, rec) => {
    if (!out.has(name)) out.set(name, []);
    out.get(name).push(rec);
  };
  const defaultedSpans = [];
  const defaultedWith = (re, nameIdx, innerIdx, kindOverride) => {
    for (const m of spans(re, text)) {
      defaultedSpans.push(m);
      const inner = m[innerIdx];
      add(m[nameIdx], { defaulted: true, kind: kindOverride || (inner === undefined ? 'expression' : defaultKind(m[nameIdx], inner)) });
    }
  };
  const bare = (re, nameIdx) => {
    for (const m of spans(re, text)) {
      if (inSpans(m.index, defaultedSpans)) continue; // already recorded with its fallback
      add(m[nameIdx], { defaulted: false, kind: null });
    }
  };

  if (ext === '.sh') {
    for (const m of spans(/\$\{([A-Z][A-Z0-9_]{2,}):\?[^}]*\}|\$\{([A-Z][A-Z0-9_]{2,})\?[^}]*\}/g, text)) {
      defaultedSpans.push(m);
      add(m[1] || m[2], { defaulted: false, kind: 'required' }); // ${X:?msg}: the script fails when unset
    }
    for (const m of spans(/\$\{([A-Z][A-Z0-9_]{2,}):-([^}]*)\}/g, text)) {
      defaultedSpans.push(m);
      const inner = m[2];
      add(m[1], { defaulted: true, kind: inner.includes('$') ? 'expression' : defaultKind(m[1], inner) });
    }
    bare(/\$\{?([A-Z][A-Z0-9_]{2,})\}?/g, 1);
    return out;
  }

  // node / vite with an inline fallback: process.env.X || 'y', process.env.X ?? "y"
  defaultedWith(/process\.env\.([A-Z][A-Z0-9_]*)\s*(?:\|\||\?\?)\s*'([^']*)'/g, 1, 2);
  defaultedWith(/process\.env\.([A-Z][A-Z0-9_]*)\s*(?:\|\||\?\?)\s*"([^"]*)"/g, 1, 2);
  defaultedWith(/process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]\s*(?:\|\||\?\?)\s*'([^']*)'/g, 1, 2);
  defaultedWith(/process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]\s*(?:\|\||\?\?)\s*"([^"]*)"/g, 1, 2);
  defaultedWith(/import\.meta\.env\.([A-Z][A-Z0-9_]*)\s*(?:\|\||\?\?)\s*'([^']*)'/g, 1, 2);
  defaultedWith(/import\.meta\.env\.([A-Z][A-Z0-9_]*)\s*(?:\|\||\?\?)\s*"([^"]*)"/g, 1, 2);
  // python with a default argument: os.getenv('X', 'y'), os.environ.get('X', 'y')
  defaultedWith(/os\.(?:environ\.get|getenv)\(\s*'([A-Z][A-Z0-9_]*)'\s*,\s*'([^']*)'\s*\)/g, 1, 2);
  defaultedWith(/os\.(?:environ\.get|getenv)\(\s*"([A-Z][A-Z0-9_]*)"\s*,\s*"([^"]*)"\s*\)/g, 1, 2);
  // Non-string defaults: a None/nil fallback means unset behaves exactly like
  // no default at all, so the read counts as bare. Anything else (a number,
  // a name, an expression) is a real fallback we cannot quote.
  for (const m of spans(/os\.(?:environ\.get|getenv)\(\s*'([A-Z][A-Z0-9_]*)'\s*,\s*([^)'"]+)\)/g, text)) {
    defaultedSpans.push(m);
    add(m[1], m[2].trim() === 'None' ? { defaulted: false, kind: null } : { defaulted: true, kind: 'expression' });
  }
  for (const m of spans(/os\.(?:environ\.get|getenv)\(\s*"([A-Z][A-Z0-9_]*)"\s*,\s*([^)"]+)\)/g, text)) {
    defaultedSpans.push(m);
    add(m[1], m[2].trim() === 'None' ? { defaulted: false, kind: null } : { defaulted: true, kind: 'expression' });
  }
  // ruby: ENV.fetch('X', 'y')
  defaultedWith(/ENV\.fetch\(\s*'([A-Z][A-Z0-9_]*)'\s*,\s*'([^']*)'/g, 1, 2);
  defaultedWith(/ENV\.fetch\(\s*"([A-Z][A-Z0-9_]*)"\s*,\s*"([^"]*)"/g, 1, 2);

  bare(/process\.env\.([A-Z][A-Z0-9_]*)/g, 1);
  bare(/process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g, 1);
  bare(/import\.meta\.env\.([A-Z][A-Z0-9_]*)/g, 1);
  bare(/os\.environ\.get\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g, 1);
  bare(/os\.environ\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g, 1);
  bare(/os\.getenv\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g, 1);
  bare(/ENV\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g, 1);
  bare(/ENV\.fetch\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g, 1);
  bare(/os\.Getenv\(\s*"([A-Z][A-Z0-9_]*)"/g, 1);
  bare(/env::var\(\s*"([A-Z][A-Z0-9_]*)"/g, 1);
  bare(/getenv\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g, 1);
  return out;
}

// Set of names, kept for callers that do not need read details.
function usedIn(text, ext) {
  return new Set(usedInReads(text, ext).keys());
}

// Map name -> { files: sorted list, reads: [{ defaulted, kind }] }.
// opts: { excludeTests: bool, exclude: iterable of extra directory names }
function scanDirDetailed(dir, root, opts) {
  opts = opts || {};
  const extra = new Set(opts.exclude || []);
  const out = new Map();
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || extra.has(e.name)) continue;
        if (opts.excludeTests && TEST_DIRS.has(e.name)) continue;
        walk(path.join(d, e.name));
        continue;
      }
      const ext = path.extname(e.name);
      if (!EXT.has(ext) || SKIP_FILE.test(e.name)) continue;
      const file = path.join(d, e.name);
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (SKIP_PATH.test(rel)) continue;
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch (err) { continue; }
      for (const [name, reads] of usedInReads(text, ext)) {
        if (!out.has(name)) out.set(name, { files: [], reads: [] });
        const rec = out.get(name);
        if (!rec.files.includes(rel)) rec.files.push(rel);
        rec.reads.push(...reads);
      }
    }
  })(dir);
  for (const v of out.values()) v.files.sort();
  return out;
}

// Map name -> sorted list of files, kept for callers that do not need read details.
function scanDir(dir, root) {
  const out = new Map();
  for (const [name, rec] of scanDirDetailed(dir, root)) out.set(name, rec.files);
  return out;
}

// Names declared in a dotenv file. Commented-out KEY=value lines count as documented.
function parseDotenv(text) {
  const declared = new Set(), commented = new Set();
  for (const line of text.split(/\r?\n/)) {
    let m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m) { declared.add(m[1]); continue; }
    m = /^\s*#\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (m) commented.add(m[1]);
  }
  return { declared, commented };
}

module.exports = { usedIn, usedInReads, scanDir, scanDirDetailed, parseDotenv };
