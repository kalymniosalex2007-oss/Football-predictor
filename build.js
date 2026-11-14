// ΕΚΚΙΝΗΤΗΣ. Βρίσκει τα αρχεία του project όπου κι αν βρίσκονται (ρίζα, lib/, public/, data/), τα τακτοποιεί στον προσωρινό φάκελο .work/
// και τρέχει το main.js. Έτσι δεν χαλάει η εγκατάσταση αν ένα αρχείο μπει σε λάθος φάκελο. Λειτουργεί και χωρίς package.json.
const fs = process.getBuiltinModule('node:fs'), path = process.getBuiltinModule('node:path'), { pathToFileURL } = process.getBuiltinModule('node:url');
const DIRS = ['.', 'lib', 'public', 'data', 'src'];
const find = n => DIRS.map(d => path.join(d, n)).find(p => fs.existsSync(p) && fs.statSync(p).isFile());
const REQUIRED = ['main', 'ai', 'analysis', 'api', 'basketball', 'ledger', 'overrides', 'pages', 'predict', 'render', 'store', 'supa', 'sync', 'tracking', 'util'].map(n => n + '.js').concat(['style.css', 'app.js']);
const OPTIONAL = ['site.json', 'overrides.json'];
const missing = REQUIRED.filter(n => !find(n));
if (missing.length) {
  console.error('\n=== ΛΕΙΠΟΥΝ ΑΡΧΕΙΑ ===\n' + missing.join('\n') + '\n\nΑνέβασέ τα στη ρίζα του repository (ή σε φάκελο lib/public/data) και τρέξε ξανά.\n');
  process.exit(1);
}
fs.rmSync('.work', { recursive: true, force: true }); fs.mkdirSync('.work');
for (const n of [...REQUIRED, ...OPTIONAL]) { const p = find(n); if (p) { fs.copyFileSync(p, path.join('.work', n)); console.log(`${n} <- ${p}`); } else if (OPTIONAL.includes(n)) console.log(`(προαιρετικό, δεν βρέθηκε: ${n})`); }
fs.writeFileSync('.work/package.json', '{"type":"module"}');
process.env.WORK_DIR = '.work';
import(pathToFileURL(path.resolve('.work/main.js')).href).catch(e => { console.error(e); process.exit(1); });
