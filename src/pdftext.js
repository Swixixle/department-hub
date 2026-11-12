// Reads the text layer of a PDF into pages of anchored passages, entirely on this device.
//
// What it reads: text a PDF carries as text, laid out in lines, paragraphs and simple ruled tables whose cells are
// one line each. What it does not read: a scanned page (a picture of text), the arrows and shapes of a diagram,
// merged or multi-line table cells, text in columns side by side, or handwriting. Those limits are reported
// in the result (emptyPages, drawn) rather than guessed around. A person checks the result against the original
// before any of it can answer a question.
import { sha256 } from './audit.js';

export const READER_FORMAT = 'department-hub-extraction-v1';
// Spaces and line breaks vary between readers; what the passage says does not.
export const normal = text => String(text || '').replace(/\s+/g, ' ').trim();
export const passageHash = async text => (await sha256('department-hub/passage-v1:' + normal(text))).slice(0, 24);

const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };
const round = value => Math.round(value * 10) / 10;
const boxOf = parts => {
  const left = Math.min(...parts.map(part => part.box[0])), top = Math.min(...parts.map(part => part.box[1]));
  return [left, top, Math.max(...parts.map(part => part.box[0] + part.box[2])) - left, Math.max(...parts.map(part => part.box[1] + part.box[3])) - top].map(round);
};

// Text runs on one baseline, split into cells wherever the gap is too wide to be a space between words.
function linesOf(items, pageHeight) {
  const runs = items.filter(item => normal(item.str)).map(item => ({ text: normal(item.str), x: item.transform[4], y: item.transform[5], width: item.width,
    size: item.height || Math.abs(item.transform[3]) || 10 })).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const run of runs) {
    const line = lines.find(candidate => Math.abs(candidate.y - run.y) <= Math.max(1.5, run.size * 0.25));
    if (line) line.runs.push(run); else lines.push({ y: run.y, runs: [run] });
  }
  return lines.map(line => {
    const cells = [];
    for (const run of line.runs.sort((a, b) => a.x - b.x)) {
      const last = cells.at(-1), gap = last ? run.x - (last.x + last.width) : 0;
      if (last && gap <= Math.max(14, run.size * 1.6)) { last.text += (gap > run.size * 0.12 ? ' ' : '') + run.text; last.width = run.x + run.width - last.x; last.size = Math.max(last.size, run.size); }
      else cells.push({ ...run });
    }
    for (const cell of cells) cell.box = [cell.x, pageHeight - cell.y - cell.size * 0.82, cell.width, cell.size * 1.18].map(round);
    return { y: line.y, size: Math.max(...cells.map(cell => cell.size)), cells };
  });
}

// A table is a run of closely spaced lines whose cells start where the first line's cells start. The first line is
// taken as the header, so each cell can be read with its column's name. Anything looser is not called a table.
function tableAt(lines, start) {
  const head = lines[start];
  if (head.cells.length < 2) return 0;
  const starts = head.cells.map(cell => cell.x), fits = line => line.cells.length >= 2 && line.cells.length <= starts.length &&
    line.cells.every(cell => starts.some(x => Math.abs(x - cell.x) <= 8));
  let count = 1;
  while (start + count < lines.length && fits(lines[start + count]) && lines[start + count - 1].y - lines[start + count].y <= head.size * 2.6) count++;
  return count >= 2 ? count : 0;
}

export function layoutPage(items, { number, width, height, drawn = false, body = null }) {
  const lines = linesOf(items, height), bodySize = body || median(lines.flatMap(line => line.cells.map(cell => cell.size))) || 10;
  const blocks = [];
  let heading = null;
  for (let index = 0; index < lines.length; index++) {
    const rows = tableAt(lines, index);
    if (rows) {
      const span = lines.slice(index, index + rows), starts = span[0].cells.map(cell => cell.x), columns = span[0].cells.map(cell => cell.text);
      const column = cell => starts.reduce((best, x, at) => Math.abs(x - cell.x) < Math.abs(starts[best] - cell.x) ? at : best, 0);
      const body = span.slice(1).map(line => {
        const cells = columns.map(() => ''), boxes = columns.map(() => null);
        for (const cell of line.cells) { cells[column(cell)] = cell.text; boxes[column(cell)] = cell.box; }
        return { cells, boxes, box: boxOf(line.cells), text: columns.map((name, at) => name + ': ' + (cells[at] || '(blank)')).join(' · ') };
      });
      blocks.push({ kind: 'table', columns, rows: body, under: heading, box: boxOf(span.flatMap(line => line.cells)), headBox: boxOf(span[0].cells),
        text: [columns.join(' | '), ...body.map(row => row.text)].join('\n') });
      index += rows - 1;
      continue;
    }
    for (const cell of lines[index].cells) {
      const last = blocks.at(-1), alone = lines[index].cells.length === 1, isHeading = alone && cell.size >= bodySize + 1.5;
      // The next line of the same paragraph: same left edge, same size, an ordinary line step below.
      if (alone && !isHeading && last?.kind === 'text' && last.open && Math.abs(last.left - cell.x) <= 3 && Math.abs(last.size - cell.size) <= 0.6 && last.y - lines[index].y <= cell.size * 1.75) {
        last.text += ' ' + cell.text; last.parts.push(cell); last.y = lines[index].y; last.box = boxOf(last.parts);
        continue;
      }
      if (last) last.open = false;
      blocks.push({ kind: isHeading ? 'heading' : 'text', text: cell.text, under: isHeading ? null : heading, box: cell.box, left: cell.x, size: cell.size, y: lines[index].y, parts: [cell], open: alone && !isHeading });
      if (isHeading) heading = cell.text;
    }
  }
  return { number, width: round(width), height: round(height), drawn, blocks: blocks.map(({ left, size, y, parts, open, ...block }, index) => ({ anchor: 'p' + number + '.b' + (index + 1), ...block })) };
}

// The same words in the same place on every page are a running header or footer, not a passage of the protocol.
function markRunning(pages) {
  if (pages.length < 2) return;
  const key = block => block.text.replace(/\d+/g, '#') + '@' + Math.round(block.box[1] / 6);
  const seen = new Map();
  for (const page of pages) for (const name of new Set(page.blocks.map(key))) seen.set(name, (seen.get(name) || 0) + 1);
  for (const page of pages) for (const block of page.blocks) if (seen.get(key(block)) === pages.length) { block.running = true; block.under = null; }
}

// Words inside a drawing are labels. "Start at 12" in a box says nothing without the arrows that lead to it, and
// the arrows are not read. A caption that names a figure is enough to suggest it; the reviewer confirms or changes it.
const FIGURE = /^(?:figure|fig\.?|diagram|flow ?chart|algorithm|decision tree)\b/i;
function suggestFigures(pages) {
  for (const page of pages) if (page.drawn) for (const block of page.blocks) if (block.kind === 'text' && !block.running && FIGURE.test(block.under || '')) block.figure = true;
}

async function seal(pages) {
  for (const page of pages) for (const block of page.blocks) {
    block.hash = await passageHash(block.text);
    for (const [index, row] of (block.rows || []).entries()) { row.anchor = block.anchor + '.r' + (index + 1); row.hash = await passageHash(row.text); }
  }
  return pages;
}

// pdfjs is passed in: the browser loads it only when a PDF is opened, and the tests use its Node build.
export async function readPdf(bytes, pdfjs) {
  const started = Date.now();
  let source;
  try { source = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise; }
  catch (error) { return { format: READER_FORMAT, reader: 'pdfjs ' + pdfjs.version, pages: [], characters: 0, emptyPages: [], unreadable: /password/i.test(String(error?.message)) ? 'This PDF is locked with a password.' : 'This file could not be read as a PDF.' }; }
  const raw = [];
  for (let number = 1; number <= source.numPages; number++) {
    const page = await source.getPage(number), view = page.getViewport({ scale: 1 }), content = await page.getTextContent();
    const operators = await page.getOperatorList();
    raw.push({ items: content.items, number, width: view.width, height: view.height, drawn: operators.fnArray.includes(pdfjs.OPS.constructPath) || operators.fnArray.includes(pdfjs.OPS.paintImageXObject) });
    page.cleanup();
  }
  await source.destroy?.();
  const body = median(raw.flatMap(page => page.items.filter(item => normal(item.str)).map(item => item.height || 10))) || 10;
  const pages = await seal(raw.map(page => layoutPage(page.items, { ...page, body })));
  markRunning(pages);
  suggestFigures(pages);
  return { format: READER_FORMAT, reader: 'pdfjs ' + pdfjs.version, pages, milliseconds: Date.now() - started,
    characters: pages.reduce((sum, page) => sum + page.blocks.reduce((count, block) => count + block.text.length, 0), 0),
    emptyPages: pages.filter(page => !page.blocks.length).map(page => page.number) };
}

// Text a reviewer typed in for a page the reader could not read. It is anchored and hashed like any passage, and it
// stays marked as supplied by a person wherever it is shown.
export async function suppliedBlocks(page, text) {
  const paragraphs = String(text || '').split(/\n\s*\n/).map(normal).filter(Boolean), blocks = [];
  for (const [index, paragraph] of paragraphs.entries()) blocks.push({ anchor: 'p' + page + '.s' + (index + 1), kind: 'text', text: paragraph, under: null, box: null, supplied: true, hash: await passageHash(paragraph) });
  return blocks;
}

// A cited place: a block (p2.b3), a table row (p2.b3.r1) or a cell (p2.b3.r1.c2), with the words around it that
// say what it means: the heading it sits under, and for a table the names of the columns.
export function passageAt(extraction, anchor) {
  const match = /^p(\d+)\.([bs]\d+)(?:\.r(\d+))?(?:\.c(\d+))?$/.exec(String(anchor || ''));
  if (!match) return null;
  const page = extraction?.pages?.find(candidate => candidate.number === Number(match[1]));
  const block = page?.blocks.find(candidate => candidate.anchor === 'p' + match[1] + '.' + match[2]);
  if (!block) return null;
  const base = { page: page.number, block: block.anchor, kind: block.kind, under: block.under || null, figure: Boolean(block.figure), running: Boolean(block.running), supplied: Boolean(block.supplied) };
  if (!match[3]) return { ...base, anchor: block.anchor, text: block.text, hash: block.hash, box: block.box, context: block.under || '' };
  const row = block.kind === 'table' ? block.rows[Number(match[3]) - 1] : null;
  if (!row) return null;
  const context = [block.under, 'table row ' + match[3]].filter(Boolean).join(' · ');
  if (!match[4]) return { ...base, anchor: row.anchor, text: row.text, hash: row.hash, box: row.box, context, columns: block.columns, cells: row.cells };
  const at = Number(match[4]) - 1;
  if (!(at in row.cells)) return null;
  // A single cell is never quoted bare. It carries its column name and the row's first cell, and is bound to the whole row.
  return { ...base, anchor: row.anchor + '.c' + match[4], text: block.columns[0] + ': ' + row.cells[0] + ' · ' + block.columns[at] + ': ' + row.cells[at], hash: row.hash, box: row.boxes[at] || row.box, context, columns: block.columns, cells: row.cells };
}

// Every place that can be cited, in reading order, for browsing, search and review.
export const passagesIn = extraction => (extraction?.pages || []).flatMap(page => page.blocks.flatMap(block => block.kind === 'table'
  ? block.rows.map(row => passageAt(extraction, row.anchor)) : [passageAt(extraction, block.anchor)]));
