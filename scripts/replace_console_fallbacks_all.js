const fs = require('fs');
const path = require('path');

function walk(dir) {
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

const srcDir = path.join(__dirname, '..', 'src');
const files = walk(srcDir).filter(f => f.endsWith('.js'));
let changed = 0;
for (const f of files) {
  // skip command files (already handled) and index.js which has console shims
  if (f.includes(path.join('src', 'commands')) || f.endsWith(path.join('src', 'index.js'))) continue;
  let s = fs.readFileSync(f, 'utf8');
  if (!s.includes('console.warn(') && !s.includes('console.error(')) continue;
  // Skip if file contains explicit console override definitions
  if (s.includes('console.warn =') || s.includes('console.error =')) continue;
  const alreadyImports = s.includes("const fallbackLogger") || s.includes("require('../utils/fallbackLogger')") || s.includes('require("../utils/fallbackLogger")');
  let ns = s;
  ns = ns.replace(/console\.warn\(/g, 'fallbackLogger.warn(').replace(/console\.error\(/g, 'fallbackLogger.error(');
  if (!alreadyImports) {
    // find insertion point after require/import block (within first 40 lines)
    const lines = ns.split('\n');
    let insertIdx = 0;
    for (let i = 0; i < Math.min(60, lines.length); i++) {
      const l = lines[i];
      if (/^\s*(const|let|var) .*require\(/.test(l) || /^\s*import .* from /.test(l)) {
        insertIdx = i + 1;
        continue;
      }
      if (insertIdx && !(/^\s*(const|let|var) .*require\(/.test(l) || /^\s*import .* from /.test(l))) { insertIdx = i; break; }
    }
    if (!insertIdx) insertIdx = 1;
    lines.splice(insertIdx, 0, "const fallbackLogger = require('../utils/fallbackLogger');");
    ns = lines.join('\n');
  }
  if (ns !== s) {
    fs.writeFileSync(f, ns, 'utf8');
    changed++;
    console.log('Patched', f);
  }
}
console.log('Done. Files changed:', changed);
