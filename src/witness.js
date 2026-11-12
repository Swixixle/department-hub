// A second witness for a captured page: screenshots of the same page, read by the app's own text reader.
//
// Blinders saved the page twice over: its rendered text, and pictures of the screen. The text is what answers. The
// pictures are read here, and each line a card cites must be found in them: the same words, in the same order, laid
// out together on the screen, with every number exactly as captured. A line the pictures do not bear out is refused.
// This checks that the captured text is what was on the screen. It does not check what the text means.
//
// The reader makes small mistakes, mostly in chemical names set with a lowered digit (PaO2 read as "PaOz"), so a word
// may differ from its picture by a letter or two, and a word the reader could not make out may be missing. A number
// may not differ at all, and a word the reader saw clearly may not be a different word.

const DASHES = /[‐-―−]/g;
export const isNumber = token => /^[<>]?\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?%?$/.test(token);
// The words of a text as the reader would see them: lower case, dashes made one kind, footnote marks and punctuation
// around a word dropped. "7.35–7.45" stays one token, so a range and its two ends are not confused.
export function tokensOf(text) {
  return String(text).replace(DASHES, '-').replace(/\[\d+\](?:,\[\d+\])*/g, ' ').replace(/[↵]/g, ' ').toLowerCase().split(/\s+/)
    .map(word => word.replace(/^[^a-z0-9<>]+|[^a-z0-9%-]+$/g, '').replace(/^(.*[a-z0-9%])-+$/, '$1-')).filter(word => /[a-z0-9]/.test(word));
}

function distance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length];
}
// A sign in front of a number is part of it: "<7.35" and ">7.35" are different readings.
const bare = token => token.replace(/-$/, '');
// Is this word of the text the word in the picture? A number must be identical; a word may be a letter or two off.
export function same(wanted, seen) {
  if (wanted === seen) return true;
  if (isNumber(bare(wanted)) || isNumber(bare(seen))) return bare(wanted) === bare(seen);
  // In a word with letters, the reader often takes the letter O for a zero ("Sa0" for SaO2).
  const a = /[a-z]/.test(wanted) ? wanted.replace(/0/g, 'o') : wanted, b = /[a-z]/.test(seen) ? seen.replace(/0/g, 'o') : seen;
  if (a === b) return true;
  if (a.length < 4) return false;
  // "increases" and "decreases" are two letters apart, so two are allowed only in long words.
  const limit = a.length >= 10 ? 2 : 1;
  return distance(a, b, limit) <= limit;
}
const clear = word => /^[a-z]{3,}$/.test(word.token) && word.confidence >= 85;

// The picture as printed lines, and each printed line as the runs of words that sit together. A wide gap between two
// words on one line is a column boundary: a table's cells are separate runs.
export function layoutOf(read) {
  const words = read.map(word => ({ ...word, token: tokensOf(word.text)[0] })).filter(word => word.token)
    .map(word => ({ ...word, x0: word.box[0], y0: word.box[1], x1: word.box[2], y1: word.box[3], cy: (word.box[1] + word.box[3]) / 2, h: word.box[3] - word.box[1] }));
  const heights = words.map(word => word.h).sort((a, b) => a - b), unit = heights[Math.floor(heights.length / 2)] || 20;
  const lines = [];
  for (const word of [...words].sort((a, b) => a.cy - b.cy)) {
    const line = lines.find(other => Math.abs(other.cy - word.cy) < unit * 0.45);
    if (line) { line.words.push(word); line.cy = (line.cy * (line.words.length - 1) + word.cy) / line.words.length; } else lines.push({ cy: word.cy, words: [word] });
  }
  const runs = [];
  for (const line of lines.sort((a, b) => a.cy - b.cy)) {
    let run = null;
    for (const word of line.words.sort((a, b) => a.x0 - b.x0)) {
      if (!run || word.x0 - run.x1 > unit * 1.6) { run = { x0: word.x0, x1: word.x1, y0: word.y0, y1: word.y1, cy: line.cy, words: [] }; runs.push(run); }
      run.words.push(word); run.x1 = word.x1; run.y0 = Math.min(run.y0, word.y0); run.y1 = Math.max(run.y1, word.y1);
    }
  }
  return { unit, runs };
}

// The words of a cell or paragraph that starts at one run: that run, then the runs stacked under it in the same
// column, close below one another, as far as `count` words. A word broken at a line end is joined to its rest.
function columnFrom(layout, start, count) {
  const out = [], { unit, runs } = layout, used = new Set();
  let run = start, guard = 0;
  while (run && out.length < count && guard++ < 60) {
    for (const word of run.words) {
      const last = out.at(-1);
      if (last && last.lineEnd && /[a-z]-$/.test(last.token) && /^[a-z]/.test(word.token)) out[out.length - 1] = { ...last, token: last.token.slice(0, -1) + word.token, boxes: [...last.boxes, word.box], confidence: Math.min(last.confidence, word.confidence ?? 100), lineEnd: false };
      else out.push({ token: word.token, boxes: [word.box], confidence: word.confidence ?? 100, lineEnd: false });
    }
    // A wide space inside a line ("compensated = the body") can split it; the rest of the printed line, close by on
    // the right, is still this paragraph.
    const right = runs.find(other => !used.has(other) && Math.abs(other.cy - run.cy) < unit * 0.45 && other.x0 > run.x1 && other.x0 - run.x1 < unit * 2.5);
    used.add(run);
    if (right) { run = right; continue; }
    if (out.length) out[out.length - 1].lineEnd = true;
    const from = run;
    run = runs.filter(other => other.cy > from.cy + unit * 0.5 && other.y0 - from.y1 < unit * 1.1 && Math.abs(other.x0 - start.x0) < unit * 1.2).sort((a, b) => a.cy - b.cy)[0];
  }
  return out;
}

// Lines up the text's words with the picture's, in order. Each step is a match, a word the reader missed, a stray mark
// the reader added, or a word read as another. Reading a word as another costs less than missing it, so that a text
// ending in "lungs" where the picture says "kidneys" is lined up word for word and found out, not stopped short.
function lineUp(wanted, seen) {
  const n = wanted.length, m = seen.length, cost = Array.from({ length: n + 1 }, () => new Float32Array(m + 1)), step = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  const skipSeen = j => clear(seen[j]) ? 1 : 0.5;
  for (let i = 1; i <= n; i++) { cost[i][0] = i; step[i][0] = 2; }
  for (let j = 1; j <= m; j++) { cost[0][j] = cost[0][j - 1] + skipSeen(j - 1); step[0][j] = 3; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const match = cost[i - 1][j - 1] + (same(wanted[i - 1], seen[j - 1].token) ? 0 : 0.9), miss = cost[i - 1][j] + 1, extra = cost[i][j - 1] + skipSeen(j - 1);
    if (match <= miss && match <= extra) { cost[i][j] = match; step[i][j] = 1; } else if (miss <= extra) { cost[i][j] = miss; step[i][j] = 2; } else { cost[i][j] = extra; step[i][j] = 3; }
  }
  // The picture may run on past the end of the text: it is free to stop anywhere.
  let end = 0;
  for (let j = 1; j <= m; j++) if (cost[n][j] < cost[n][end]) end = j;
  const ops = [];
  for (let i = n, j = end; i > 0 || j > 0;) {
    const kind = i === 0 ? 3 : j === 0 ? 2 : step[i][j];
    if (kind === 1) { ops.push({ kind: same(wanted[i - 1], seen[j - 1].token) ? 'match' : 'swap', said: wanted[i - 1], shown: seen[j - 1] }); i--; j--; }
    else if (kind === 2) { ops.push({ kind: 'missed', said: wanted[i - 1] }); i--; }
    else { ops.push({ kind: 'extra', shown: seen[j - 1] }); j--; }
  }
  return ops.reverse();
}

// How a stretch of the text stands against a stretch of the picture.
function judge(wanted, ops) {
  const said = ops.filter(op => op.said !== undefined);
  const missingNumbers = said.filter(op => isNumber(op.said) && op.kind !== 'match').map(op => op.said);
  // A word the text has where the picture clearly shows another word, any number read as another, or a clearly read
  // word in the middle of the line that the text does not have.
  const contradictions = ops.filter(op => op.kind === 'swap' && ((clear(op.shown) && /^[a-z]{2,}$/.test(op.said)) || isNumber(bare(op.said)) || isNumber(bare(op.shown.token))))
    .map(op => ({ said: op.said, shown: op.shown.token }));
  const first = ops.findIndex(op => op.kind === 'match'), last = ops.length - 1 - [...ops].reverse().findIndex(op => op.kind === 'match');
  if (first >= 0) for (const op of ops.slice(first, last + 1)) if (op.kind === 'extra' && clear(op.shown)) contradictions.push({ said: '', shown: op.shown.token });
  return { words: wanted.length, matched: ops.filter(op => op.kind === 'match').length, missingNumbers, contradictions, boxes: ops.filter(op => op.kind === 'match').flatMap(op => op.shown.boxes) };
}

export const WORDS_NEEDED = 0.75, CARD_WORDS_NEEDED = 0.85;

// Could this run be where these words begin? One of the first three words must be one of the run's first three,
// which allows a list number ("2.") or a garbled first word ("CO?") in front.
const opens = (wanted, run) => wanted.slice(0, 3).some(token => run.words.slice(0, 3).some(word => same(token, word.token)));

// One line of the captured text: a paragraph, or a table row whose cells are separated by tabs. Each cell is looked
// for as a column of the picture; a row's cells must begin on the same printed line, left to right.
function witnessLine(text, shots) {
  const cells = text.split('\t').map(tokensOf).filter(cell => cell.length), all = cells.flat();
  if (!all.length) return null;
  let best = null;
  const score = one => (one.ok ? 1e6 : 0) + one.matched - one.contradictions.length * 3;
  // A row is found from its first cell, or, when that cell is a short label the reader could not make out (a lone
  // "SaO2"), from its second, with the label counted as missed. A label holding a number is never skipped.
  const skippable = cells.length > 1 && cells[0].length <= 2 && !cells[0].some(isNumber);
  for (const shot of shots) for (const layout of shot.layouts) for (const from of skippable ? [0, 1] : [0]) {
    for (const start of layout.runs) {
      if (!opens(cells[from], start)) continue;
      const results = from ? [{ words: cells[0].length, matched: 0, missingNumbers: [], contradictions: [], boxes: [] }] : [];
      let anchor = start, placed = true;
      for (const [c, cell] of cells.entries()) {
        if (c < from) continue;
        let run = start;
        if (c > from) {
          // The next cell starts to the right, on the row's first printed line or just below it.
          run = layout.runs.filter(other => other.x0 > anchor.x1 && Math.abs(other.cy - start.cy) < layout.unit * 1.6 && opens(cell, other))
            .sort((a, b) => Math.abs(a.cy - start.cy) - Math.abs(b.cy - start.cy) || a.x0 - b.x0)[0];
        }
        if (!run) { placed = false; results.push({ words: cell.length, matched: 0, missingNumbers: cell.filter(isNumber), contradictions: [], boxes: [] }); continue; }
        results.push(judge(cell, lineUp(cell, columnFrom(layout, run, cell.length + 4))));
        anchor = run;
      }
      const result = { words: all.length, matched: results.reduce((sum, one) => sum + one.matched, 0), missingNumbers: results.flatMap(one => one.missingNumbers),
        contradictions: results.flatMap(one => one.contradictions), boxes: results.flatMap(one => one.boxes), shot: shot.id };
      result.ok = placed && !result.missingNumbers.length && !result.contradictions.length && result.matched / result.words >= WORDS_NEEDED;
      if (!best || score(result) > score(best)) best = result;
    }
  }
  return best || { words: all.length, matched: 0, missingNumbers: all.filter(isNumber), contradictions: [], boxes: [], shot: null, ok: false };
}

// Looks for one passage in the pictures, line by line.
export function witnessPassage(text, shots) {
  const lines = String(text).split('\n').map(one => witnessLine(one, shots)).filter(Boolean);
  const words = lines.reduce((sum, one) => sum + one.words, 0), matched = lines.reduce((sum, one) => sum + one.matched, 0);
  return { words, matched, share: words ? matched / words : 0, missingNumbers: lines.flatMap(one => one.missingNumbers), contradictions: lines.flatMap(one => one.contradictions),
    failed: lines.filter(one => !one.ok).length, shots: [...new Set(lines.map(one => one.shot).filter(Boolean))], boxes: lines.map(one => ({ shot: one.shot, boxes: one.boxes })), ok: lines.length > 0 && lines.every(one => one.ok) };
}

// Every passage of a card, and the card as a whole.
export function witnessCard(passages, shots) {
  const each = passages.map(text => witnessPassage(text, shots)), words = each.reduce((sum, one) => sum + one.words, 0), matched = each.reduce((sum, one) => sum + one.matched, 0);
  return { passages: each, words, matched, share: words ? matched / words : 0, ok: each.every(one => one.ok) && words > 0 && matched / words >= CARD_WORDS_NEEDED };
}

// A screenshot ready to be searched: each of its readings laid out as printed lines and runs.
export const shotOf = (id, readings) => ({ id, layouts: readings.map(layoutOf) });
