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

const cmdDir = path.join(__dirname, '..', 'src', 'commands');
const files = walk(cmdDir).filter(f => f.endsWith('.js'));
let changed = 0;
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8');
  if (s.includes('console.warn(') || s.includes('console.error(')) {
    // Skip if file already manages console shims or is index-like
    if (s.includes('console.warn =') || s.includes('console.error =')) continue;
    if (s.includes("const fallbackLogger") || s.includes("require('../utils/fallbackLogger')") || s.includes('require("../utils/fallbackLogger")')) {
      // already imports; just replace occurrences
      const ns = s.replace(/console\.warn\(/g, 'fallbackLogger.warn(').replace(/console\.error\(/g, 'fallbackLogger.error(');
      if (ns !== s) {
        fs.writeFileSync(f, ns, 'utf8');
        changed++;
        console.log('Updated', f);
      }
      continue;
    }
    // Only add import for files under src/commands (depth 3)
    // Insert import after the initial require() block
    const lines = s.split('\n');
    let insertIdx = 0;
    for (let i = 0; i < Math.min(40, lines.length); i++) {
      const l = lines[i];
      if (/^\s*const .*require\(/.test(l) || /^\s*let .*require\(/.test(l) || /^\s*var .*require\(/.test(l)) {
        insertIdx = i + 1;
        continue;
      }
      // stop when non-require line encountered after some requires
      if (insertIdx && !/^\s*(const|let|var) .*require\(/.test(l)) { insertIdx = i; break; }
    }
    if (!insertIdx) insertIdx = 1;
    const relImport = "const fallbackLogger = require('../utils/fallbackLogger');";
    const ns = (lines.slice(0, insertIdx).join('\n') + '\n' + relImport + '\n' + lines.slice(insertIdx).join('\n')).replace(/console\.warn\(/g, 'fallbackLogger.warn(').replace(/console\.error\(/g, 'fallbackLogger.error(');
    if (ns !== s) {
      fs.writeFileSync(f, ns, 'utf8');
      changed++;
      console.log('Patched', f);
    }
  }
}
console.log('Done. Files changed:', changed);
