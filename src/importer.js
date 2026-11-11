import { createWorker } from 'tesseract.js';
import { mergeAssignments, verifyRoster } from './model.js';
import { inkMask, maskToRgba, backgroundColor, tintName, longStrokes, tightBox, withoutRules } from './pixels.js';
import { parsePhoneList, mergePhoneReads } from './contacts.js';
import { parseCalendar, reconcileNames } from './calendar.js';

const asset = path => new URL(import.meta.env.BASE_URL + path, window.location.href).href;

export const hashBytes = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
  .map(value => value.toString(16).padStart(2, '0')).join('');

export function parseDate(value) {
  const text = value.trim();
  let parts = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text)?.slice(1);
  if (!parts) {
    const us = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
    if (us) parts = [us[3], us[1], us[2]];
  }
  if (!parts) return null;
  const [year, month, day] = parts;
  const iso = [year, month.padStart(2, '0'), day.padStart(2, '0')].join('-');
  const parsed = new Date(iso + 'T12:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

export function combineBox(words) {
  return [
    Math.min(...words.map(word => word.x0)), Math.min(...words.map(word => word.y0)),
    Math.max(...words.map(word => word.x1)), Math.max(...words.map(word => word.y1))
  ].map(Math.round);
}

function groupRows(words) {
  const rows = [];
  for (const word of [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const y = (word.y0 + word.y1) / 2;
    const row = rows.find(item => Math.abs(item.y - y) < Math.max(7, (word.y1 - word.y0) * 0.55));
    if (row) row.words.push(word);
    else rows.push({ y, words: [word] });
  }
  return rows.map(row => ({ ...row, words: row.words.sort((a, b) => a.x0 - b.x0) }));
}

const label = word => word.text.toUpperCase().replace(/[^A-Z]/g, '');
const looksLikeName = value => /^[\p{L}][\p{L}\p{M} .'’,-]{1,70}$/u.test(value) && !/^(?:none|open|off|vacant|unfilled)$/i.test(value);

function splitNames(words) {
  const groups = [];
  let current = [];
  for (const word of words) {
    const fragments = word.text.split(/([/;|])/);
    for (const fragment of fragments) {
      if (/^[/;|]$/.test(fragment)) {
        if (current.length) groups.push(current);
        current = [];
      } else if (fragment.trim()) current.push({ ...word, text: fragment.trim() });
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

export function parsePage(words, source, context = {}) {
  const rows = groupRows(words.filter(word => word.text.trim()));
  const assignments = [];
  const flags = [];
  const dates = new Set();
  const addFlag = (message, relevant, draft = {}) => flags.push({
    message, source: { ...source, box: relevant.length ? combineBox(relevant) : null },
    draft, status: 'open'
  });
  const assign = (date, shift, person, relevant) => {
    if (!date || !shift || !looksLikeName(person) || relevant.some(word => word.confidence < 65)) {
      addFlag('Check the date, shift, or name in this cell.', relevant, { date, shift, person });
      return;
    }
    assignments.push({ date, shift, person, sources: [{ ...source, box: combineBox(relevant) }] });
  };

  const header = rows.find(row => ['DATE', 'DAY', 'NIGHT'].every(key => row.words.some(word => label(word) === key)));
  if (header) {
    const day = header.words.find(word => label(word) === 'DAY').x0;
    const night = header.words.find(word => label(word) === 'NIGHT').x0;
    for (const row of rows.filter(item => item.y > header.y + 15)) {
      const dateWords = row.words.filter(word => word.x0 < day - 20);
      const date = parseDate(dateWords.map(word => word.text).join('').replace(/\s/g, ''));
      if (date) dates.add(date);
      const dayWords = row.words.filter(word => word.x0 >= day - 20 && word.x0 < night - 20);
      const nightWords = row.words.filter(word => word.x0 >= night - 20);
      if (!date && !dayWords.length && !nightWords.length) continue;
      if (!date) addFlag('Read this row date from the original.', dateWords.length ? dateWords : row.words);
      for (const [shift, column] of [['D', dayWords], ['N', nightWords]]) {
        const groups = splitNames(column);
        if (!groups.length && date) addFlag('Check whether this shift column is blank.', dateWords, { date, shift });
        for (const group of groups) assign(date, shift, group.map(word => word.text).join(' '), group);
      }
    }
    if (!dates.size) addFlag('No complete dates were found in the schedule rows.', []);
    return { layout: 'date rows', assignments, flags, dates: [...dates] };
  }

  const matrix = rows.find(row => row.words.filter(word => parseDate(word.text)).length >= 2);
  if (matrix) {
    const columns = matrix.words.filter(word => parseDate(word.text)).map(word => ({
      date: parseDate(word.text), x: (word.x0 + word.x1) / 2
    }));
    columns.forEach(column => dates.add(column.date));
    const firstBoundary = columns[0].x - (columns[1].x - columns[0].x) / 2;
    for (const row of rows.filter(item => item.y > matrix.y + 15)) {
      const names = row.words.filter(word => (word.x0 + word.x1) / 2 < firstBoundary);
      const person = names.map(word => word.text).join(' ');
      for (const word of row.words.filter(word => !names.includes(word))) {
        const center = (word.x0 + word.x1) / 2;
        const column = columns.reduce((best, entry) => Math.abs(entry.x - center) < Math.abs(best.x - center) ? entry : best);
        const code = label(word);
        if (['OFF', 'PTO', 'VAC', 'X'].includes(code) || /^[-—–]+$/.test(word.text)) continue;
        const shift = ['D', 'DAY'].includes(code) ? 'D' : ['N', 'NIGHT'].includes(code) ? 'N' : null;
        assign(column.date, shift, person, [...names, word]);
      }
    }
    if (!assignments.length && !flags.length) addFlag('No supported shift codes were found in the grid.', []);
    return { layout: 'employee grid', assignments, flags, dates: [...dates] };
  }
  const calendar = parseCalendar(words.filter(word => word.text.trim()), source, context);
  if (calendar) return calendar;
  addFlag('Unknown page layout. Use a clearer crop or a supported roster layout.', []);
  return { layout: 'unrecognized', assignments, flags, dates: [] };
}

const ocrWords = data => (data.blocks || []).flatMap(block => block.paragraphs || [])
  .flatMap(paragraph => paragraph.lines || []).flatMap(line => line.words || [])
  .map(word => ({ ...word.bbox, text: word.text, confidence: word.confidence }));

export async function readBatch(files, onProgress, onSource) {
  const worker = await createWorker('eng', 1, {
    workerPath: asset('ocr/worker.min.js'),
    corePath: asset('ocr'),
    langPath: asset('ocr'),
    workerBlobURL: false,
    cacheMethod: 'none'
  });
  const seen = new Set();
  const pages = [];
  const flags = [];
  const rows = [];
  const people = [];
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    for (const [index, file] of files.entries()) {
      onProgress(index + 1, files.length);
      const bytes = await file.arrayBuffer();
      const page = await hashBytes(bytes);
      if (seen.has(page)) {
        pages.push({ name: file.name, page, status: 'duplicate', dates: [] });
        continue;
      }
      seen.add(page);
      const source = { page, file: file.name };
      try {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        const ratio = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.round(bitmap.width * ratio);
        canvas.height = Math.round(bitmap.height * ratio);
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        await onSource(page, file, { width: canvas.width, height: canvas.height });
        // Read a black-and-white copy with the highlighter removed. Colour and pen strokes are checked on the original.
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const mask = inkMask(image);
        context.putImageData(new ImageData(maskToRgba(mask), canvas.width, canvas.height), 0, 0);
        const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
        const words = ocrWords(data);
        let paper = null;
        const colorOf = box => backgroundColor(image, tightBox(mask, image.width, box));
        const parsed = parsePage(words, source, {
          tintOf: box => {
            if (paper === null) {
              const saturations = words.map(word => colorOf([word.x0, word.y0, word.x1, word.y1]).saturation).sort((a, b) => a - b);
              paper = saturations[Math.floor(saturations.length * 0.2)] ?? 0.05;
            }
            return tintName(colorOf(box), paper);
          },
          strokesIn: (region, minLength) => longStrokes(mask, image.width, region, minLength)
        });
        // A page that is not a schedule may be a telephone list. Its table rules are erased and it is read twice,
        // in two different ways, so that a number is trusted only when both readings agree.
        if (parsed.layout === 'unrecognized') {
          context.putImageData(new ImageData(maskToRgba(withoutRules(mask, canvas.width, canvas.height)), canvas.width, canvas.height), 0, 0);
          const reads = [];
          for (const mode of ['11', '6']) {
            await worker.setParameters({ tessedit_pageseg_mode: mode });
            const { data: again } = await worker.recognize(canvas, {}, { blocks: true, text: false });
            reads.push(parsePhoneList(ocrWords(again), source));
          }
          const list = mergePhoneReads(reads[0], reads[1]);
          if (list) {
            people.push(...list.people);
            pages.push({ name: file.name, page, status: 'phone list', dates: [], count: list.people.length });
            continue;
          }
        }
        flags.push(...parsed.flags);
        rows.push(...parsed.assignments);
        pages.push({
          name: file.name, page, status: parsed.layout, dates: parsed.dates, count: parsed.assignments.length,
          ...(parsed.shift ? { shift: parsed.shift, shiftGuessed: parsed.shiftGuessed } : {})
        });
      } catch (error) {
        flags.push({ message: 'Page could not be decoded or read: ' + error.message, source, draft: {}, status: 'open' });
        pages.push({ name: file.name, page, status: 'unreadable', dates: [] });
      }
    }
  } finally {
    await worker.terminate();
  }
  // A lost space is repaired quietly and listed. A near-miss spelling is put to the reviewer, never merged silently.
  const cleaned = reconcileNames(rows);
  const asked = new Set();
  for (const { from, to, row, kind, index } of cleaned.changes) {
    const { sources, ...draft } = row;
    if (kind === 'similar') asked.add(index);
    flags.push({
      message: kind === 'similar' ? 'Read "' + from + '". Did it mean ' + to + '?' : 'Read "' + from + '" as ' + to + '.',
      source: sources[0], draft: { ...draft, person: to }, status: kind === 'similar' ? 'open' : 'corrected'
    });
  }
  const renamed = new Map(cleaned.changes.map(change => [change.from, change.to]));
  for (const flag of flags) if (renamed.has(flag.draft.person)) flag.draft.person = renamed.get(flag.draft.person);
  const kept = cleaned.rows.filter((row, index) => !asked.has(index));
  const assignments = mergeAssignments(kept);
  return { pages, assignments, flags, issues: verifyRoster(assignments), people };
}
