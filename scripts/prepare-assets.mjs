import { cp, mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const here = process.cwd();
const core = resolve(here, 'node_modules/tesseract.js-core');
const target = resolve(here, 'public/ocr');
await mkdir(target, { recursive: true });
await cp('node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js');
for (const filename of await readdir(core)) {
  if (/^tesseract-core.*\.(js|wasm)$/.test(filename)) await cp(resolve(core, filename), resolve(target, filename));
}
await cp('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'public/ocr/eng.traineddata.gz');
for (const [path, name] of [
  ['node_modules/tesseract.js/LICENSE.md', 'Tesseract.js.txt'],
  ['node_modules/tesseract.js-core/LICENSE', 'Tesseract.js-core.txt'],
  ['node_modules/@tesseract.js-data/eng/LICENSE', 'Tesseract-English.txt'],
]) {
  await cp(path, 'public/ocr/' + name).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
const fixtures = spawnSync('python3', ['scripts/make-fixtures.py'], { stdio: 'inherit' });
if (fixtures.status !== 0) process.exit(fixtures.status || 1);
