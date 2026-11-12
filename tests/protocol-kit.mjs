// Shared by the protocol tests: reads the committed invented PDFs the same way the app does.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../src/audit.js';
import { readPdf } from '../src/pdftext.js';
import { addRevision, checkExtraction, markMappingsReviewed, activate, emptyLibrary } from '../src/protocols.js';

export const LABEL = 'Synthetic test material — NOT FOR CLINICAL USE';
export const fixturePath = name => fileURLToPath(new URL((name === 'no-text-page.pdf' ? './fixtures/protocols/' : '../public/fixtures/protocols/') + name, import.meta.url));
export const expectedPath = name => fileURLToPath(new URL('./fixtures/protocols/' + name, import.meta.url));
export const DIGESTS = {
  'rt-train-014-rev1.pdf': 'd09ae851f3b242a33c69c0e6db5e2eb2620ec2ea2cfb1b254cefa98c16a67ed4',
  'rt-train-014-rev2.pdf': '7cce7d9d091e1a2a0e083e2af1a7d8006fbefbb2a571050a42392a0f57bdfd09',
  'no-text-page.pdf': '3a7d310b5f79b01ce9f02674a4021d1dfe0b5896d9d0409fee88c9c9921bdf38' };
export const META = {
  1: { title: 'Blue Trainer Bellows Drill', identifier: 'RT-TRAIN-014', authority: 'Lakeside Training Hospital Respiratory Education Committee (fictional)', label: '1', effective: '2026-06-01',
    category: 'Training drill', location: 'Department Hub test fixture' },
  2: { title: 'Blue Trainer Bellows Drill', identifier: 'RT-TRAIN-014', authority: 'Lakeside Training Hospital Respiratory Education Committee (fictional)', label: '2', effective: '2026-11-01',
    category: 'Training drill', location: 'Department Hub test fixture' } };

let pdfjs = null;
const held = new Map();
// The Node build of the same reader the browser loads. Its notice about missing canvas support is expected: nothing is drawn here.
export async function reader() { return pdfjs ||= await import('pdfjs-dist/legacy/build/pdf.mjs'); }
export async function loadFixture(name) {
  if (!held.has(name)) {
    const bytes = readFileSync(fixturePath(name));
    held.set(name, { name, bytes, digest: await sha256(bytes), extraction: await readPdf(bytes, await reader()) });
  }
  return structuredClone(held.get(name));
}
export const ok = result => { if (!result.ok) throw new Error('Refused: ' + result.why); return result; };
export async function addFixture(library, number, overrides = {}, who = 'Avery Stone', at = '2026-11-10T09:00:00.000Z') {
  const file = await loadFixture('rt-train-014-rev' + number + '.pdf');
  return addRevision(library, { ...META[number], ...overrides, digest: file.digest, extraction: file.extraction, file: { name: file.name, bytes: file.bytes.length } }, who, at);
}
// A library holding revision 1 taken through every step, with no answers mapped. The mapped answers have their own kit.
export async function activeLibrary(today = '2026-11-11') {
  let step = ok(await addFixture(emptyLibrary(), 1));
  const id = step.revision.id;
  step = ok(checkExtraction(step.library, id, 'Avery Stone', '2026-11-10T09:05:00.000Z'));
  step = ok(markMappingsReviewed(step.library, id, 'Avery Stone', '2026-11-10T09:10:00.000Z'));
  step = ok(activate(step.library, id, 'Avery Stone', '2026-11-10T09:15:00.000Z', today));
  return { library: step.library, id };
}
