// Verifies that every import in the project resolves to a real file or an installed/declared package.
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const declared = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'data' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) files.push(p);
  }
})(root);

let bad = 0;
const re = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(re)) {
    const spec = m[1];
    if (spec.startsWith('node:') || builtinModules.includes(spec)) continue;
    if (spec.startsWith('.')) {
      if (!fs.existsSync(path.resolve(path.dirname(f), spec))) { console.error(`MISSING FILE  ${path.relative(root, f)} -> ${spec}`); bad++; }
    } else if (!declared.has(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])) {
      console.error(`UNDECLARED PACKAGE  ${path.relative(root, f)} -> ${spec}`); bad++;
    }
  }
}
console.log(bad ? `\n${bad} problem(s) found.` : `OK: all imports in ${files.length} files resolve.`);
process.exit(bad ? 1 : 0);
