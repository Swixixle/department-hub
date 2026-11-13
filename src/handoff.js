// Handoff: one therapist's report for the oncoming therapist, built on this phone and never sent anywhere.
//
// A bed-number handoff is still patient information: the person it is handed to knows exactly who is in bed 12. So the
// rules here are about where it lives, not about pretending it is anonymous. It lives on this phone only, in its own
// store: not the workspace, not a backup, not a receipt, not the server. It is wiped 13 hours after it was started, or
// the moment its writer taps "Handed off". It leaves the phone only as paper or as the screen shown at the bedside.
//
// What goes in is kept to what a handoff needs: a bed number and the clinical picture. Names, record numbers, birth
// dates and the like are stopped as they are typed, dictated or read off a photo, the same screen the board uses, with
// two differences: a bed number is expected here, and an age is allowed unless it is over 89 (the age HIPAA itself
// treats as identifying). A capitalised pair of words that is not a known clinical term is stopped as a possible name
// until its writer says it is not one.
import { patientFindings } from './guard.js';

export const WIPE_HOURS = 13;
export const HANDOFF_DB = 'department-hub-handoff-v1';

// The template: what every bed's entry holds. One place to change it for a department's own sheet.
export const SUPPORT = ['Vent', 'NIV', 'HFNC', 'Trach collar', 'O2', 'Room air'];
export const TEMPLATE = [
  { key: 'support', label: 'Support', kind: 'choice', options: SUPPORT },
  { key: 'airway', label: 'Airway', hint: '7.5 ETT 23 at lip · 6.0 cuffed trach' },
  { key: 'mode', label: 'Mode', hint: 'VC-AC, PRVC, PS/CPAP, BiPAP', short: true },
  { key: 'rate', label: 'Rate', hint: 'set / total', short: true },
  { key: 'vt', label: 'Vt', hint: 'mL', short: true },
  { key: 'peep', label: 'PEEP', hint: 'cm H2O', short: true },
  { key: 'fio2', label: 'FiO2', hint: '%', short: true },
  { key: 'ps', label: 'PS / IPAP', hint: 'cm H2O', short: true },
  { key: 'flow', label: 'Flow', hint: 'L/min', short: true },
  { key: 'abg', label: 'Last ABG', hint: '7.38/42/80/24 at 0400' },
  { key: 'treatments', label: 'Treatments', hint: 'DuoNeb q4, next 0800' },
  { key: 'sbt', label: 'SBT / wean', hint: 'passed 30 min at 0500' },
  { key: 'events', label: 'Events this shift', long: true },
  { key: 'plan', label: 'Plan / pending', long: true }
];
export const FIELD_KEYS = TEMPLATE.map(field => field.key);
const LIMIT = 240;

const id = () => (globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2));
export const newReport = (now = Date.now(), shift = 'N') => ({ id: id(), startedAt: now, shift, beds: [], notNames: [] });
export const expiresAt = report => report.startedAt + WIPE_HOURS * 3600000;
export const expired = (report, now = Date.now()) => !report || now >= expiresAt(report);

// A bed number: what a unit writes on its board. Short, letters, digits and a dash; never a name.
export const cleanBed = value => String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
export const validBed = value => /^[A-Z0-9][A-Z0-9 -]{0,7}$/.test(cleanBed(value)) && /\d/.test(value);

export function addBed(report, bed) {
  const label = cleanBed(bed);
  if (!validBed(label)) return { ok: false, why: 'A bed is a short number like 12, 412-2 or 7B. No names.' };
  if (report.beds.some(entry => entry.bed === label)) return { ok: false, why: 'Bed ' + label + ' is already on this handoff.' };
  return { ok: true, report: { ...report, beds: [...report.beds, { id: id(), bed: label, fields: {}, photos: [] }].sort((a, b) => a.bed.localeCompare(b.bed, undefined, { numeric: true })) } };
}

export const removeBed = (report, bedId) => ({ ...report, beds: report.beds.filter(entry => entry.id !== bedId) });

// Sets fields on one bed, each through the screen. Returns what was refused, with the words that set it off.
export function setFields(report, bedId, values) {
  const refused = [], bed = report.beds.find(entry => entry.id === bedId);
  if (!bed) return { ok: false, why: 'That bed is not on this handoff.' };
  const fields = { ...bed.fields };
  for (const [key, raw] of Object.entries(values)) {
    if (!FIELD_KEYS.includes(key)) continue;
    const value = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMIT);
    const found = screenHandoff(value, report.notNames);
    if (found.length) { refused.push({ key, found }); continue; }
    if (value) fields[key] = value; else delete fields[key];
  }
  const next = { ...report, beds: report.beds.map(entry => entry.id === bedId ? { ...entry, fields } : entry) };
  return { ok: !refused.length, report: next, refused };
}

// Words a unit uses that start with a capital and are not names. Anything else in a capitalised pair is asked about.
const CLINICAL = new Set(('ac vc pc prvc simv cpap bipap bilevel aprv nava asv psv ps peep epap ipap fio2 vt vte vti ve mv rr niv hfnc hfo ett trach shiley ' +
  'bivona portex tracoe passy muir valve cuff cuffed cuffless uncuffed abg vbg cbg etco2 spo2 sao2 pao2 paco2 hco3 ph lactate ' +
  'albuterol levalbuterol ipratropium duoneb atrovent xopenex pulmicort budesonide racemic epinephrine epi heliox nitric ino veletri flolan ' +
  'room ventilator vent settings setting f fset ftot ftotal rr o2 o2% vte vti ppeak pplat pmean psupp insp exp ie i:e flow lpm ml cc cm h2o mmhg lpm % ' +
  'acetylcysteine mucomyst hypertonic saline nacl dornase pulmozyme tobramycin colistin vest acapella metaneb ipv cpt ' +
  'icu ccu micu sicu cvicu nicu picu ed er or pacu step down med surg tele stepdown floor unit ' +
  'sbt rsbi nif mip mep fvc pplat ppeak pip map driving pressure compliance resistance auto ' +
  'copd chf ards pna pneumonia asthma sepsis covid rsv flu aspiration pe ptx pneumothorax ' +
  'left right bilateral upper lower lobe rll rul lll lul rml base bases ' +
  'q1 q2 q3 q4 q6 q8 q12 qid tid bid prn stat daily hs am pm noon midnight ' +
  'extubated intubated reintubated extubation intubation trial wean weaning passed failed held tolerated rested ' +
  'day night shift doc md np pa rn rt dr icu attending fellow resident ' +
  'monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december ' +
  'the a an and or no not on off in at to for with without per of plan pending events support airway mode rate flow treatments ' +
  'suction suctioned secretions thick thin tan white yellow green bloody frothy copious moderate scant small large ' +
  'stable unstable improved worse same sats desat desats desaturation increased decreased weaned titrated ' +
  'chest xray cxr ct bronch bronchoscopy family code rapid response ok okay will needs need check follow up').split(' '));

const NAME_PAIR = /\b([A-Z][a-z'’]+(?:-[A-Z][a-z'’]+)?)\s+([A-Z][a-z'’]+(?:-[A-Z][a-z'’]+)?)\b/g;
const known = word => CLINICAL.has(word.toLowerCase().replace(/['’]s$/, ''));

// Possible names: two capitalised words side by side, neither a known term, not one its writer has said is no name.
export function possibleNames(text, notNames = []) {
  const said = new Set(notNames.map(phrase => phrase.toLowerCase()));
  return [...String(text || '').matchAll(NAME_PAIR)].map(hit => hit[0]).filter(pair => !pair.split(/\s+/).every(known) && !pair.split(/\s+/).some(known) && !said.has(pair.toLowerCase()));
}

export function screenHandoff(text, notNames = []) {
  const value = String(text || '');
  const found = patientFindings(value).filter(item => item.sign !== 'a patient with a room or bed' && !(item.sign === 'a patient’s age' && !/\b(?:9\d|1[0-2]\d)\b/.test(item.words)));
  for (const pair of possibleNames(value, notNames)) found.push({ sign: 'what may be a name', words: pair, name: true });
  return found;
}

export const allowNotName = (report, phrase) => ({ ...report, notNames: [...new Set([...report.notNames, String(phrase).trim()])].filter(Boolean) });

// ——— Dictation: what was said, into the template. Plain keyword reading; anything it cannot place goes into events.
const NUMBER_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
export function digits(text) {
  return String(text).replace(/\b((?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-](?:one|two|three|four|five|six|seven|eight|nine))\b/gi, match => { const [tens, unit] = match.toLowerCase().split(/[\s-]/); return String(NUMBER_WORDS[tens] + NUMBER_WORDS[unit]); })
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi, word => String(NUMBER_WORDS[word.toLowerCase()]));
}

// Spoken labels, in the order they are looked for. Each takes the words after it, up to the next label.
const SPOKEN = [
  ['bed', /\b(?:bed|room)\s*(?:number\s*)?/i],
  ['support', /\b(?:on|support(?:\s+is)?)\s+(?:the\s+)?(?:ventilator|vent|niv|bipap|cpap|high[\s-]?flow(?:\s+nasal\s+cannula)?|hfnc|trach collar|nasal cannula|room air)\b/i],
  ['airway', /\b(?:airway|tube|ett|trach(?:eostomy)?)\b(?!\s+collar)\s*(?:is\s*)?/i],
  ['mode', /\bmode\s*(?:is\s*|of\s*)?/i],
  ['rate', /\b(?:set\s+)?(?:respiratory\s+)?rate\s*(?:is\s*|of\s*)?/i],
  ['vt', /\b(?:tidal\s+volume|vt|volume)\s*(?:is\s*|of\s*)?/i],
  ['peep', /\b(?:peep|pep)\s*(?:is\s*|of\s*)?/i],
  ['fio2', /\b(?:fio2|fi\s?o2|f\s?i\s?o\s?2|oxygen|o2)\s*(?:is\s*|of\s*|at\s*)?/i],
  ['ps', /\b(?:pressure\s+support|ps|ipap)\s*(?:is\s*|of\s*)?/i],
  ['flow', /\bflow\s*(?:is\s*|of\s*|at\s*)?/i],
  ['abg', /\b(?:last\s+)?(?:abg|blood\s+gas|gas)\s*(?:is\s*|was\s*)?/i],
  ['treatments', /\b(?:treatments?|nebs?|nebulizers?)\s*(?:are\s*|is\s*)?/i],
  ['sbt', /\b(?:sbt|breathing\s+trial|wean(?:ing)?)\s*/i],
  ['events', /\b(?:events?|overnight|tonight|today)\s*(?:were\s*|was\s*)?/i],
  ['plan', /\b(?:plan|pending|to\s*do|todo)\s*(?:is\s*)?/i]
];
const SUPPORT_SAID = [[/high[\s-]?flow|hfnc/i, 'HFNC'], [/bipap|niv|non[\s-]?invasive/i, 'NIV'], [/cpap/i, 'NIV'], [/trach collar/i, 'Trach collar'], [/nasal cannula|\bnc\b/i, 'O2'], [/room air/i, 'Room air'], [/vent|ventilator/i, 'Vent']];
const NUMBERISH = { rate: /^\d{1,2}(?:\s*(?:\/|over)\s*\d{1,2})?/, vt: /^\d{2,4}/, peep: /^\d{1,2}/, fio2: /^\d{2,3}/, ps: /^\d{1,2}/, flow: /^\d{1,2}/ };

// Splits a dictated paragraph into bed sections and fields. Returns [{ bed, fields, rest }]: `rest` is what it could
// not place, to be shown, never dropped.
export function parseDictation(transcript) {
  const text = digits(String(transcript || '')).replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const marks = [];
  for (const [key, pattern] of SPOKEN) {
    const global = new RegExp(pattern.source, 'gi');
    for (const hit of text.matchAll(global)) if (!marks.some(mark => hit.index < mark.end && hit.index + hit[0].length > mark.at)) marks.push({ key, at: hit.index, end: hit.index + hit[0].length, said: hit[0] });
  }
  marks.sort((a, b) => a.at - b.at);
  // Events and plan are free speech: inside them, "SBT" or "oxygen" is part of the sentence, not a new field.
  for (let index = 0, open = false; index < marks.length; index++) {
    if (open && !['bed', 'events', 'plan'].includes(marks[index].key)) { marks.splice(index--, 1); continue; }
    open = ['events', 'plan'].includes(marks[index].key);
  }
  const beds = [], start = { bed: '', fields: {}, rest: '' };
  let current = start;
  const lead = text.slice(0, marks[0]?.at ?? text.length).trim();
  if (lead) start.rest = lead.replace(/[\s.,;]+$/, '');
  marks.forEach((mark, index) => {
    const said = text.slice(mark.end, marks[index + 1]?.at ?? text.length).replace(/^[\s,.:;-]+|[\s,.;-]+$/g, '');
    if (mark.key === 'bed') {
      const number = said.match(/^([0-9]{1,4}(?:\s*-?\s*[0-9a-z])?)\b/i);
      current = { bed: number ? cleanBed(number[1].replace(/\s+/g, '')) : '', fields: {}, rest: number ? said.slice(number[0].length).replace(/^[\s,.:;-]+/, '') : said };
      beds.push(current);
      return;
    }
    if (mark.key === 'support') { const kind = SUPPORT_SAID.find(([pattern]) => pattern.test(mark.said)); if (kind) current.fields.support = kind[1]; if (said) current.rest = (current.rest + ' ' + said).trim(); return; }
    if (NUMBERISH[mark.key]) {
      const number = said.match(NUMBERISH[mark.key]);
      if (number) { current.fields[mark.key] = number[0].replace(/\s*over\s*/, '/').replace(/\s+/g, ''); const after = said.slice(number[0].length).replace(/^\s*(?:percent|%|liters?|l|ml|cc|centimeters?|cm|of water|h2o)\b\.?/i, '').trim(); if (after) current.rest = (current.rest + ' ' + after).trim(); }
      else current.rest = (current.rest + ' ' + said).trim();
      return;
    }
    if (said) current.fields[mark.key] = current.fields[mark.key] ? current.fields[mark.key] + '; ' + said : said;
  });
  if (start.rest || Object.keys(start.fields).length) beds.unshift(start);
  return beds;
}

// ——— Photos: read a vent screen into settings; work out what to box out of a chart photo.
const LABELS = { rate: /^(?:f|rr|rate|ftot|ftotal|fset|f-set|f-tot|resp\.?rate)$/i, vt: /^(?:vt|vte|vti|vtexp|vt-exp|tidal)$/i, peep: /^(?:peep|epap)$/i,
  fio2: /^(?:fio2|fi02|%o2|o2%|o2|02|oxygen)$/i, ps: /^(?:ps|psupp|psv|ipap|δp|deltap|∆psupp|pinsp|pi)$/i, flow: /^(?:flow|v̇|lpm)$/i };
const MODE = /^(?:a\/c|ac|vc|pc|prvc|simv|cpap|psv|aprv|bilevel|bi-level|vc\+|vc-ac|pc-ac|prvc\/ac|cmv|asv|nava|spont|ps\/cpap|cpap\/ps|bipap|st)$/i;
const VALUE = /^\d{1,4}(?:\.\d+)?%?$/;
const centre = box => ({ x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, h: box.y1 - box.y0 });

// words: [{ text, confidence, bbox: { x0, y0, x1, y1 } }], as the text reader gives them. Each label takes the nearest
// number to its right on the same line, or else just below it. Nothing is guessed: a label with no number near it is
// left out, and every value is shown for the person to accept or correct.
export function readVentWords(words) {
  const clean = words.map(word => ({ ...word, text: String(word.text).replace(/[:=]+$/, '').trim() })).filter(word => word.text);
  const found = {}, numbers = clean.filter(word => VALUE.test(word.text));
  const mode = clean.find(word => MODE.test(word.text));
  if (mode) found.mode = mode.text.toUpperCase();
  for (const [key, label] of Object.entries(LABELS)) {
    const tag = clean.find(word => label.test(word.text));
    if (!tag) continue;
    const at = centre(tag.bbox);
    const near = numbers.map(word => ({ word, c: centre(word.bbox) }))
      .filter(({ c }) => (Math.abs(c.y - at.y) < at.h * 0.9 && c.x > at.x) || (c.y > at.y && c.y - at.y < at.h * 4 && Math.abs(c.x - at.x) < at.h * 3))
      .sort((a, b) => Math.hypot(a.c.x - at.x, a.c.y - at.y) - Math.hypot(b.c.x - at.x, b.c.y - at.y))[0];
    if (near) found[key] = near.word.text.replace(/%$/, '');
  }
  return found;
}

// Chart photos: keep a word only if it is a known clinical term or a short number that is not a date; box out
// everything else, every word the reader was unsure of, and every word on a line that names a person or a record.
// Keeping by an allow list, not stopping by a deny list, is what makes a missed name fail safe: a name is not on the
// list, so it is boxed out whether or not anything recognised it as a name.
const RECORD_LINE = /\b(?:name|patient|pt|mrn|dob|birth|acct|account|fin|csn|encounter|visit|admit|admitted|attending|physician|provider|sex|gender|age|address|phone|insurance|guarantor|allerg\w*|ssn)\b/i;
const DATE = /^\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?$/;
const SHORT = /^[<>≤≥]?\d{1,4}(?:\.\d+)?(?:%|ml|cc|cm|mmhg|l|lpm|bpm)?$/i;
const COMPOUND = /^\d{1,2}\.\d{1,2}(?:\/\d{1,3}){1,3}$/;      // an ABG written 7.38/42/80/24
export function keepWord(text, confidence = 100) {
  const word = String(text).replace(/^[([{"'“]+|[)\]},.;:"'”]+$/g, '');
  if (!word) return true;                                     // punctuation alone holds nothing
  if (confidence < 60) return false;
  if (DATE.test(word)) return false;
  if (SHORT.test(word) || COMPOUND.test(word)) return true;
  return known(word);
}
export function maskPlan(words, pad = 3) {
  const lines = new Map();
  for (const word of words) { const key = word.line ?? Math.round(centre(word.bbox).y / Math.max(8, centre(word.bbox).h)); (lines.get(key) || lines.set(key, []).get(key)).push(word); }
  const boxes = [];
  let kept = 0;
  for (const line of lines.values()) {
    const named = RECORD_LINE.test(line.map(word => word.text).join(' '));
    for (const word of line) {
      if (!named && keepWord(word.text, word.confidence)) { kept++; continue; }
      boxes.push({ x: Math.max(0, word.bbox.x0 - pad), y: Math.max(0, word.bbox.y0 - pad), w: word.bbox.x1 - word.bbox.x0 + pad * 2, h: word.bbox.y1 - word.bbox.y0 + pad * 2 });
    }
  }
  return { boxes, kept, boxed: boxes.length };
}

// ——— The sheet: what prints, and what the bedside screen shows.
export function sheetOf(report) {
  return report.beds.map(bed => ({ bed: bed.bed, lines: TEMPLATE.filter(field => bed.fields[field.key]).map(field => [field.label, bed.fields[field.key]]), photos: bed.photos.length }));
}
