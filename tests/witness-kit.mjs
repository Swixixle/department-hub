// The held Blinders capture of the blood-gas page, as the app holds it when the cards are added: the text, the
// licence line, and each screenshot's bytes, size and the app's text reader's readings of it (recorded in a browser by
// scripts/read-capture-shots.cjs, so these tests run on the reader's real output without a browser).
import { readFileSync } from 'node:fs';
const file = path => readFileSync(new URL('../src/reference/' + path, import.meta.url));
export const shipped = () => JSON.parse(file('cards-blood-gases.json').toString('utf8'));
export const PAGE = 'sources/blinders-cef48181-5ed3-4ff5-b07d-382304cdcf95', LICENCE = 'sources/blinders-b0473561-e3f8-41c7-bb7f-0f8267669a62';
const size = bytes => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
export const readingsOf = id => JSON.parse(readFileSync(new URL('./fixtures/witness/blinders-' + id + '.readings.json', import.meta.url), 'utf8'));
export function held() {
  return { text: file(PAGE + '.txt').toString('utf8'), licence: file(LICENCE + '.txt').toString('utf8'),
    shots: shipped().source.screenshots.map(({ id }) => { const bytes = file('sources/blinders-' + id + '.png'); return { id, bytes: new Uint8Array(bytes), ...size(bytes), readings: readingsOf(id) }; }) };
}
export { file };
