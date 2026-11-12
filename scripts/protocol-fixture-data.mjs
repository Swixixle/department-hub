#!/usr/bin/env node
// Optional. Rewrites the expected reading of each invented PDF from what the reader returns now.
// Run it only after deliberately changing a fixture or the reader, then read the diff: the tests
// compare every later reading with these files, so whatever is written here becomes "correct".
import { writeFileSync } from 'node:fs';
import { loadFixture, expectedPath } from '../tests/protocol-kit.mjs';

export const slim = extraction => ({ format: extraction.format, emptyPages: extraction.emptyPages, pages: extraction.pages.map(page => ({ number: page.number, drawn: page.drawn,
  blocks: page.blocks.map(block => ({ anchor: block.anchor, kind: block.kind, ...(block.running ? { running: true } : {}), ...(block.figure ? { figure: true } : {}), under: block.under, hash: block.hash, box: block.box,
    ...(block.kind === 'table' ? { columns: block.columns, rows: block.rows.map(row => ({ anchor: row.anchor, hash: row.hash, cells: row.cells, text: row.text })) } : { text: block.text }) })) })) });

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  for (const name of ['rt-train-014-rev1', 'rt-train-014-rev2', 'no-text-page']) {
    const file = await loadFixture(name + '.pdf');
    writeFileSync(expectedPath(name + '.expected.json'), JSON.stringify({ note: 'Synthetic test material — NOT FOR CLINICAL USE. Expected reading of ' + name + '.pdf.', sha256: file.digest, ...slim(file.extraction) }, null, 1) + '\n');
    console.log('wrote', name + '.expected.json', file.extraction.pages.length, 'pages');
  }
}
