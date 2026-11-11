// Reads a printed month-style calendar: a weekday header, one cell per date ("11/29"), names listed under each date.
// The page carries no year and no shift label, so both are worked out here and shown for confirmation.
import { addDays } from './model.js';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const ROLE_BY_TINT = { pink: 'charge', green: 'icu', yellow: 'extra' };
const HOURS = /^\d{1,2}(?::\d{2})?-\d{1,2}(?::\d{2})?[AaPp]?$/;
const trim = text => text.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };
const mode = values => { const counts = new Map(); for (const value of values) counts.set(value, (counts.get(value) || 0) + 1); return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]; };
const box = words => [Math.min(...words.map(w => w.x0)), Math.min(...words.map(w => w.y0)), Math.max(...words.map(w => w.x1)), Math.max(...words.map(w => w.y1))].map(Math.round);
const title = text => text.toLowerCase().replace(/(^|[\s'’-])\p{L}/gu, letter => letter.toUpperCase());

function isoDate(year, month, day) {
  const text = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  const parsed = new Date(text + 'T12:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === text ? text : null;
}
const weekday = date => new Date(date + 'T12:00:00Z').getUTCDay();

// Least-squares line through [x, y] points, returned as a function of x.
function trend(points, fallbackSlope = 0) {
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p[0], 0) / n, meanY = points.reduce((sum, p) => sum + p[1], 0) / n;
  const spread = points.reduce((sum, p) => sum + (p[0] - meanX) ** 2, 0);
  const slope = spread ? points.reduce((sum, p) => sum + (p[0] - meanX) * (p[1] - meanY), 0) / spread : fallbackSlope;
  return x => meanY + slope * (x - meanX);
}

function lines(words) {
  const rows = [];
  for (const word of [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const y = (word.y0 + word.y1) / 2;
    const row = rows.find(item => Math.abs(item.y - y) < Math.max(7, (word.y1 - word.y0) * 0.55));
    if (row) row.words.push(word);
    else rows.push({ y, words: [word] });
  }
  return rows.map(row => ({ ...row, words: row.words.sort((a, b) => a.x0 - b.x0) }));
}

export function shortDates(words) {
  return words.map(word => ({ word, match: /^(\d{1,2})\/(\d{1,2})$/.exec(word.text.replace(/^[^\d]+|[^\d]+$/g, '')) }))
    .filter(entry => entry.match).map(({ word, match }) => ({
      word, month: Number(match[1]), day: Number(match[2]), x: word.x0, y: (word.y0 + word.y1) / 2, height: word.y1 - word.y0
    })).filter(entry => entry.month >= 1 && entry.month <= 12 && entry.day >= 1 && entry.day <= 31);
}

// context: { today, shift, tintOf(box), strokesIn(region, minLength) }. All optional.
export function parseCalendar(words, source, context = {}) {
  const tokens = shortDates(words);
  if (tokens.length < 6) return null;
  const flags = [];
  const addFlag = (message, relevant, draft = {}, status = 'open') => flags.push({
    message, source: { ...source, box: relevant?.length === 4 ? relevant.map(Math.round) : relevant?.length ? box(relevant) : null }, draft, status
  });
  const textHeight = median(tokens.map(token => token.height)) || 20;

  // Week rows, top to bottom.
  const rows = [];
  for (const token of [...tokens].sort((a, b) => a.y - b.y)) {
    const row = rows.at(-1);
    if (row && token.y - row.at(-1).y < textHeight * 2.5) row.push(token);
    else rows.push([token]);
  }
  rows.forEach(row => row.sort((a, b) => a.x - b.x));

  // Column width from neighbouring dates in the same month, then a column number for every date.
  const gaps = [];
  for (const row of rows) {
    for (let i = 1; i < row.length; i++) {
      const days = row[i].month === row[i - 1].month ? row[i].day - row[i - 1].day : 0;
      if (days >= 1 && days <= 6) gaps.push((row[i].x - row[i - 1].x) / days);
    }
  }
  const columnWidth = median(gaps);
  if (!columnWidth) return null;
  const left = Math.min(...tokens.map(token => token.x));
  for (const token of tokens) token.column = Math.round((token.x - left) / columnWidth);
  const span = Math.max(...tokens.map(token => token.column));
  if (span > 6) return null;

  // Which weekday the first column is. A full seven-column grid starts on Sunday unless the header says otherwise.
  const headers = words.map(word => ({ word, index: WEEKDAYS.indexOf(trim(word.text).toUpperCase().slice(0, 3)) }))
    .filter(entry => entry.index >= 0 && trim(entry.word.text).length <= 9 && entry.word.y1 < rows[0][0].y);
  const offsets = headers.map(({ word, index }) => (index - Math.floor(((word.x0 + word.x1) / 2 - left + columnWidth * 0.12) / columnWidth) + 7) % 7);
  const firstWeekday = headers.length >= 2 ? mode(offsets) : 0;

  // The year is whichever one puts each date on its column's weekday.
  const year = Number((context.today || new Date().toISOString().slice(0, 10)).slice(0, 4));
  for (const token of tokens) {
    token.date = [year, year + 1, year - 1].map(candidate => isoDate(candidate, token.month, token.day))
      .find(date => date && weekday(date) === (token.column + firstWeekday) % 7) || null;
  }
  const starts = rows.map((row, index) => mode(row.filter(token => token.date).map(token => addDays(token.date, -token.column - 7 * index))));
  const base = mode(starts.filter(Boolean));
  if (!base) {
    addFlag('The dates on this page could not be matched to a calendar year. Check the photo.', []);
    return { layout: 'calendar grid', assignments: [], flags, dates: [] };
  }
  if (starts.some(start => start && start !== base)) addFlag('Some dates on this page were read out of order. Check the date span.', []);
  if (span < 6 && headers.length < 2) addFlag('Fewer than seven day columns were found. Check that the dates are right.', []);

  // Cell geometry. A photo is rarely square to the page, so each row gets its own lines.
  const slopes = rows.filter(row => row.length >= 3).map(row => (row.at(-1).y - row[0].y) / (row.at(-1).column - row[0].column || 1));
  const tilt = median(slopes);
  const rowY = rows.map(row => trend(row.map(token => [token.column, token.y]), tilt));
  const rowX = rows.map(row => row.length >= 2 && row.at(-1).column > row[0].column
    ? trend(row.map(token => [token.column, token.x])) : column => left + column * columnWidth);
  const rowGap = rows.length > 1 ? median(rows.slice(1).map((row, index) => rowY[index + 1](3) - rowY[index](3))) : textHeight * 9;
  const cells = [];
  rows.forEach((row, r) => {
    for (let column = 0; column <= 6; column++) {
      const top = rowY[r](column) + textHeight * 0.6;
      cells.push({
        r, column, date: addDays(base, r * 7 + column), top,
        bottom: r + 1 < rows.length ? rowY[r + 1](column) - textHeight * 1.25 : top + rowGap - textHeight * 1.85,
        left: rowX[r](column) - columnWidth * 0.12, right: rowX[r](column + 1) - columnWidth * 0.12, words: []
      });
    }
  });
  const dateWords = new Set(tokens.map(token => token.word));
  for (const word of words) {
    if (dateWords.has(word) || !trim(word.text)) continue;
    const x = (word.x0 + word.x1) / 2, y = (word.y0 + word.y1) / 2;
    cells.find(cell => x >= cell.left && x < cell.right && y >= cell.top && y < cell.bottom)?.words.push(word);
  }

  // Printed names are capitals. Handwriting is ignored unless it strikes a printed name out.
  const found = [];
  for (const cell of cells) {
    cell.names = [];
    const region = { x0: cell.left, y0: cell.top, x1: cell.right, y1: cell.bottom };
    // The printed grid has long level lines too. They span the cell or sit on its lower edge.
    const strokes = (context.strokesIn?.(region, textHeight * 1.9) || []).filter(stroke =>
      stroke.length < (cell.right - cell.left) * 0.85 && stroke.y < cell.bottom - textHeight * 0.3);
    cell.struck = strokes.length;
    for (const line of lines(cell.words)) {
      const top = Math.min(...line.words.map(w => w.y0)), bottom = Math.max(...line.words.map(w => w.y1));
      if (strokes.some(stroke => stroke.y > top - 2 && stroke.y < bottom + 2)) continue;
      const parts = [];
      let hours = null;
      const used = [];
      // "K7-3" is an initial run into the hours.
      const pieces = line.words.flatMap(word => {
        const joined = /^([A-Z])(\d.*)$/.exec(trim(word.text));
        return joined ? [{ ...word, text: joined[1] }, { ...word, text: joined[2] }] : [word];
      });
      for (const word of pieces) {
        const text = trim(word.text);
        if (!hours && /^[A-Z]{3,}$/.test(text) && parts.length < 3) parts.push(text);
        else if (!hours && parts.length && /^[A-Z]$/.test(text)) parts.push(text);
        else if (parts.length && HOURS.test(text)) hours = text.replace(/[AaPp]$/, '');
        else break;
        used.push(word);
      }
      if (!parts.length) continue;
      const tint = context.tintOf?.(box(used.slice(0, parts.length))) || null;
      cell.names.push({ person: parts.join(' '), hours, role: ROLE_BY_TINT[tint] || null, words: used, cell });
    }
    found.push(...cell.names);
    if (strokes.length) addFlag('A name is crossed out here. Check who is working.', [region.x0, region.y0, region.x1, region.y1], { date: cell.date, person: '' });
  }

  // Day pages list more people per cell than night pages. A written label wins. The guess is shown for confirmation.
  const expected = mode(cells.map(cell => cell.names.length).filter(Boolean)) || 0;
  const label = words.find(word => word.y1 < rows[0][0].y && /^(night|nights|day|days)$/i.test(trim(word.text)));
  const shift = context.shift || (label ? (/^n/i.test(trim(label.text)) ? 'N' : 'D') : expected >= 4 ? 'D' : 'N');
  const assignments = [];
  for (const cell of cells) {
    for (const entry of cell.names) {
      const draft = { date: cell.date, shift, person: title(entry.person), ...(entry.hours ? { hours: entry.hours } : {}), ...(entry.role ? { role: entry.role } : {}) };
      if (entry.words.some(word => word.confidence < 65)) addFlag('Check this name against the photo.', entry.words, draft);
      else assignments.push({ ...draft, sources: [{ ...source, box: box(entry.words) }] });
    }
    if (!cell.struck && cell.names.length < expected) {
      addFlag('Fewer names were read here than in most cells. Check the photo.', [cell.left, cell.top, cell.right, cell.bottom], { date: cell.date, shift, person: '' });
    }
  }
  for (const flag of flags) if (flag.draft.date && !flag.draft.shift) flag.draft.shift = shift;
  return {
    layout: 'calendar grid', assignments, flags, dates: cells.map(cell => cell.date).sort(),
    shift, shiftGuessed: !context.shift && !label
  };
}

const distance = (a, b) => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
};

// Cleans up names across a batch. "JORDANK" and "JORDAN K" are the same reading with a lost space, and the
// spaced form wins. A name read once or twice that is nearly a name read many times is treated as a misread of it.
// Every change is returned so the review screen can list it.
export function reconcileNames(rows, known = []) {
  const squash = name => name.replace(/\s+/g, '').toLowerCase();
  const tally = list => { const counts = new Map(); for (const row of list) counts.set(row.person, (counts.get(row.person) || 0) + 1); return counts; };
  const changes = [];
  const rename = (row, to, kind, index) => { changes.push({ from: row.person, to, row, kind, index }); return { ...row, person: to }; };

  let counts = tally(rows);
  const spelling = new Map();
  for (const name of [...known, ...counts.keys()]) {
    const key = squash(name), current = spelling.get(key);
    const better = !current || (name.includes(' ') && !current.includes(' ')) ||
      (name.includes(' ') === current.includes(' ') && (counts.get(name) || 0) > (counts.get(current) || 0));
    if (better) spelling.set(key, name);
  }
  let fixed = rows.map((row, index) => spelling.get(squash(row.person)) === row.person ? row : rename(row, spelling.get(squash(row.person)), 'spacing', index));

  counts = tally(fixed);
  const trusted = [...new Set([...known.map(name => spelling.get(squash(name))), ...[...counts].filter(([, count]) => count >= 3).map(([name]) => name)])];
  fixed = fixed.map((row, index) => {
    if (trusted.includes(row.person)) return row;
    const target = squash(row.person);
    const ranked = trusted.map(name => ({ name, gap: distance(target, squash(name)) })).sort((a, b) => a.gap - b.gap);
    const limit = target.length >= 6 ? 2 : 1;
    if (!ranked.length || ranked[0].gap > limit || (ranked[1] && ranked[1].gap === ranked[0].gap)) return row;
    return rename(row, ranked[0].name, 'similar', index);
  });
  return { rows: fixed, changes };
}
