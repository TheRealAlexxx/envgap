'use strict';
// Find environment variable names a codebase reads, and the ones a dotenv file declares.
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'vendor', '__pycache__', '.venv', 'target']);
const EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.php', '.sh']);

const PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,                    // node
  /process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]*)/g,               // vite
  /os\.environ\.get\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,     // python
  /os\.environ\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
  /os\.getenv\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  /ENV\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,             // ruby
  /ENV\.fetch\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  /os\.Getenv\(\s*"([A-Z][A-Z0-9_]*)"/g,                 // go
  /env::var\(\s*"([A-Z][A-Z0-9_]*)"/g,                   // rust
  /getenv\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,               // php
  /\$\{?([A-Z][A-Z0-9_]{2,})\}?/g,                       // shell, only in .sh (filtered below)
];

function usedIn(text, ext) {
  const found = new Set();
  const pats = ext === '.sh' ? PATTERNS : PATTERNS.slice(0, -1);
  for (const re of pats) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) found.add(m[1]);
  }
  return found;
}

// Returns Map name -> sorted list of files.
function scanDir(dir, root) {
  const out = new Map();
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(d, e.name)); continue; }
      const ext = path.extname(e.name);
      if (!EXT.has(ext)) continue;
      const file = path.join(d, e.name);
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch (err) { continue; }
      for (const name of usedIn(text, ext)) {
        if (!out.has(name)) out.set(name, []);
        out.get(name).push(path.relative(root, file));
      }
    }
  })(dir);
  for (const v of out.values()) v.sort();
  return out;
}

// Names declared in a dotenv file. Commented-out KEY=value lines count as "optional".
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

module.exports = { usedIn, scanDir, parseDotenv };
