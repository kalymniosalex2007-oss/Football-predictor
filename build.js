
// ΕΚΚΙΝΗΤΗΣ. Βρίσκει τα αρχεία του project όπου κι αν βρίσκονται
// (ρίζα, lib/, public/, data/, src/), τα τακτοποιεί στον προσωρινό
// φάκελο .work/ και τρέχει το main.js.

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const { pathToFileURL } = process.getBuiltinModule('node:url');

const DIRS = ['.', 'lib', 'public', 'data', 'src'];

const find = n =>
  DIRS.map(d => path.join(d, n))
    .find(p => fs.existsSync(p) && fs.statSync(p).isFile());

const REQUIRED = [
  'main.js',
  'ai.js',
  'analysis.js',
  'api.js',
  'apifootballcom.js',
  'basketball.js',
  'ledger.js',
  'overrides.js',
  'pages.js',
  'predict.js',
  'render.js',
  'store.js',
  'supa.js',
  'sync.js',
  'tracking.js',
  'util.js',
  'style.css',
  'app.js'
];

const OPTIONAL = [
  'site.json',
  'overrides.json'
];

const missing = REQUIRED.filter(n => !find(n));

if (missing.length) {
  console.error(
    '\n=== ΛΕΙΠΟΥΝ ΑΡΧΕΙΑ ===\n' +
    missing.join('\n') +
    '\n\nΑνέβασέ τα στη ρίζα του repository ' +
    '(ή σε φάκελο lib/public/data/src) και τρέξε ξανά.\n'
  );
  process.exit(1);
}

fs.rmSync('.work', {
  recursive: true,
  force: true
});

fs.mkdirSync('.work');

for (const n of [...REQUIRED, ...OPTIONAL]) {
  const p = find(n);

  if (p) {
    fs.copyFileSync(p, path.join('.work', n));
    console.log(`${n} <- ${p}`);
  } else if (OPTIONAL.includes(n)) {
    console.log(`(προαιρετικό, δεν βρέθηκε: ${n})`);
  }
}

fs.writeFileSync(
  '.work/package.json',
  '{"type":"module"}'
);

process.env.WORK_DIR = '.work';

import(
  pathToFileURL(path.resolve('.work/main.js')).href
).catch(e => {
  console.error(e);
  process.exit(1);
});
