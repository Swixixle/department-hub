// A department telephone list: reading a photographed one, and matching its people to the names on the schedule.

export const GROUPS = ['Staff', 'Contract', 'PRN', 'Student', 'Leadership', 'Physician'];
export const STATUS_BY_GROUP = { Staff: 'Staff', Contract: 'Contract', PRN: 'PRN', Student: 'Student', Leadership: 'Staff' };

const digits = text => String(text || '').replace(/\D/g, '');
const title = text => text.toLowerCase().replace(/(^|[\s'’-])\p{L}/gu, letter => letter.toUpperCase());
const box = words => [Math.min(...words.map(w => w.x0)), Math.min(...words.map(w => w.y0)), Math.max(...words.map(w => w.x1)), Math.max(...words.map(w => w.y1))].map(Math.round);
export const personId = person => (person.last + ',' + person.first).trim().toLowerCase().replace(/\s+/g, ' ');
export const fullName = person => [person.title === 'Dr.' ? 'Dr.' : '', person.first, person.last].filter(Boolean).join(' ');
export const formatPhone = value => { const d = digits(value); return d.length === 10 ? d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6) : String(value || ''); };
export const phoneLink = (kind, value, body) => {
  const d = digits(value);
  if (d.length !== 10) return null;
  return kind === 'sms' ? 'sms:+1' + d + (body ? '?&body=' + encodeURIComponent(body) : '') : 'tel:+1' + d;
};

const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };
const centre = word => [(word.x0 + word.x1) / 2, (word.y0 + word.y1) / 2];

// Rows of a photographed table. Words are first gathered into short text lines. A photo is rarely level and the
// page is rarely flat, so each line gets its own slope, taken from a straight-line fit of slope against height.
// A number then belongs to the line that points at it.
function tableRows(words) {
  const isNumber = word => /\d/.test(word.text) && !/\p{L}{2,}/u.test(word.text);
  const texts = words.filter(word => !isNumber(word) && /\p{L}/u.test(word.text));
  const rows = [];
  for (const word of [...texts].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const [x, y] = centre(word);
    const row = rows.find(item => Math.abs(item.y - y) < (word.y1 - word.y0) * 0.5 && x - item.right < (word.y1 - word.y0) * 6);
    if (row) { row.words.push(word); row.right = Math.max(row.right, word.x1); row.y = (row.y * (row.words.length - 1) + y) / row.words.length; }
    else rows.push({ y, right: word.x1, words: [word], numbers: [] });
  }
  rows.sort((a, b) => a.y - b.y);
  const samples = [];
  for (const row of rows) {
    // The reader can return a line twice, once whole and once in pieces. Keep the surer word where two overlap.
    const kept = [];
    for (const word of [...row.words].sort((a, b) => b.confidence - a.confidence)) {
      const overlaps = kept.some(other => Math.min(word.x1, other.x1) - Math.max(word.x0, other.x0) > Math.min(word.x1 - word.x0, other.x1 - other.x0) * 0.4);
      if (!overlaps) kept.push(word);
    }
    row.words = kept.sort((a, b) => a.x0 - b.x0);
    const [x1, y1] = centre(row.words[0]), [x2, y2] = centre(row.words.at(-1));
    row.x = (x1 + x2) / 2;
    if (x2 - x1 > 80) samples.push([row.y, (y2 - y1) / (x2 - x1)]);
  }
  let slopeAt = () => 0;
  if (samples.length >= 4) {
    const meanY = samples.reduce((sum, p) => sum + p[0], 0) / samples.length, meanS = median(samples.map(p => p[1]));
    const kept = samples.filter(p => Math.abs(p[1] - meanS) < 0.05);
    const my = kept.reduce((sum, p) => sum + p[0], 0) / kept.length, ms = kept.reduce((sum, p) => sum + p[1], 0) / kept.length;
    const spread = kept.reduce((sum, p) => sum + (p[0] - my) ** 2, 0);
    const change = spread ? kept.reduce((sum, p) => sum + (p[0] - my) * (p[1] - ms), 0) / spread : 0;
    slopeAt = y => ms + change * (y - my);
  }
  const pitch = median(rows.slice(1).map((row, index) => row.y - rows[index].y).filter(gap => gap > 8)) || 40;
  for (const word of words.filter(isNumber)) {
    const [x, y] = centre(word);
    let best = null, least = pitch * 0.5;
    for (const row of rows) {
      const miss = Math.abs(row.y + slopeAt(row.y) * (x - row.x) - y);
      if (miss < least) { least = miss; best = row; }
    }
    best?.numbers.push(word);
  }
  for (const row of rows) row.numbers.sort((a, b) => a.x0 - b.x0);
  return { rows, pitch };
}

const PARTICLES = new Set(['de', 'la', 'le', 'da', 'di', 'du', 'el', 'al', 'st', 'mc', 'o']);
const ROLES = /\b(MANAGER|DIRECTOR|SUPERVISOR|COORDINATOR|LEAD|EDUCATOR)\b/i;

// Returns null when the page is not a telephone list.
export function parsePhoneList(words, source) {
  words = words.filter(word => word.text.trim());
  const plain = words.map(word => word.text.toUpperCase().replace(/[^A-Z]/g, ''));
  const numbers = words.filter(word => digits(word.text).length >= 10).length;
  if (!(plain.includes('EMPLOYEE') || plain.includes('TELEPHONE') || plain.includes('CELL')) ||
      numbers + words.filter(word => /^\d{4}$/.test(word.text.trim())).length < 3) return null;
  const { rows, pitch } = tableRows(words);
  const people = [];
  let group = 'Staff', sections = 0;
  for (const row of rows) {
    const label = row.words.map(word => word.text).join(' ').replace(/\s+/g, ' ').trim();
    const upper = label.toUpperCase();
    const doctor = /^\W*DR\b\.?\s*(\p{L}{3,})/iu.exec(label);
    if (!label.includes(',') && !doctor) {
      const before = group;
      if (/CONTRACT|RESERVE/.test(upper)) group = 'Contract';
      else if (/\bPRN\b/.test(upper)) group = 'PRN';
      else if (/STUDENT/.test(upper)) group = 'Student';
      else if (/DIRECTOR/.test(upper) && people.at(-1)?.group === 'Physician' && !people.at(-1).role) people.at(-1).role = title(label.replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim());
      if (group !== before) sections++;
      continue;
    }
    if (/EMPLOYEE|TELEPHONE/.test(upper)) continue;
    const comma = label.indexOf(',');
    const clean = part => part.replace(/[^\p{L}\s'’.-]/gu, ' ').replace(/\s+/g, ' ').trim();
    let person;
    if (doctor) person = { last: title(doctor[1]), first: '', title: 'Dr.', role: '', group: 'Physician' };
    else {
      // Stray marks from the table edge read as one or two letters in front of the surname.
      const lastWords = clean(label.slice(0, comma)).split(' ');
      while (lastWords.length > 1 && lastWords[0].length <= 2 && !PARTICLES.has(lastWords[0].toLowerCase())) lastWords.shift();
      let firstPart = clean(label.slice(comma + 1).split(/\s[–—-]\s/)[0]);
      const role = ROLES.exec(label.slice(comma + 1));
      const cut = role ? firstPart.toUpperCase().indexOf(role[1].toUpperCase()) : -1;
      if (cut >= 0) firstPart = clean(firstPart.slice(0, cut));
      const firstWords = firstPart.split(' ').filter((part, index) => index === 0 || part.length > 2);
      person = { last: title(lastWords.join(' ')), first: title(firstWords.join(' ')), title: '', role: role ? title(role[1]) : '', group: role ? 'Leadership' : group };
      if (person.last.replace(/[^\p{L}]/gu, '').length < 3 || person.first.replace(/[^\p{L}]/gu, '').length < 3) continue;
    }
    const pieces = row.numbers.map(word => word.text.trim());
    const office = pieces.find(item => /^\d{4}$/.test(item)) || '';
    const cellDigits = digits(pieces.filter(item => item !== office).join(''));
    const cell = cellDigits.length > 10 ? cellDigits.slice(0, 10) : cellDigits;
    const entry = {
      ...person, id: personId(person), cell, office, rowY: row.y,
      // A number that is not ten digits, or a shaky reading of it, is marked for a closer look.
      check: (cell ? cell.length !== 10 : !office) || row.numbers.some(word => word.confidence < 65),
      source: { ...source, box: box([...row.words, ...row.numbers]) }
    };
    // The reader sometimes returns the same line twice.
    const twin = people.findIndex(other => Math.abs(other.rowY - entry.rowY) < pitch * 0.5);
    if (twin < 0) people.push(entry);
    else if (entry.cell.length === 10 && people[twin].cell.length !== 10) people[twin] = entry;
  }
  return people.length >= 3 ? { layout: 'phone list', assignments: [], flags: [], dates: [], people, pitch, sections } : null;
}

// Two readings of the same page. People are paired by where their line sits on the photo. A number counts as
// read only when both readings agree on every digit. Anything else is marked for a closer look.
export function mergePhoneReads(primary, secondary) {
  if (!primary || !secondary) {
    const only = primary || secondary;
    return only && { ...only, people: only.people.map(person => ({ ...person, check: true })) };
  }
  if (secondary.sections > primary.sections) [primary, secondary] = [secondary, primary];
  const others = [...secondary.people];
  const people = primary.people.map(person => {
    const index = others.findIndex(other => Math.abs(other.rowY - person.rowY) < primary.pitch * 0.5);
    const other = index >= 0 ? others.splice(index, 1)[0] : null;
    const cell = person.cell.length === 10 ? person.cell : other?.cell.length === 10 ? other.cell : person.cell || other?.cell || '';
    const agreed = other && person.office === other.office && (person.cell.length === 10 ? person.cell === other.cell : !person.cell && !other.cell && Boolean(person.office));
    // "Marian Ne" and "Marianne" are the same reading with a stray space. The unbroken one wins.
    const squash = text => text.replace(/\s+/g, '').toLowerCase();
    const named = other && other.last === person.last && (squash(other.first) === squash(person.first)
      ? other.first.length < person.first.length : other.first.length > person.first.length) ? other : person;
    return { ...person, first: named.first, id: personId(named), cell, office: person.office || other?.office || '', check: !agreed };
  });
  for (const other of others) people.push({ ...other, check: true });
  people.sort((a, b) => a.rowY - b.rowY);
  return { ...primary, people };
}

// Matches schedule names ("Avery", "Jordan K", "Sam") to people on the list.
// Sure matches: first name plus last initial, then a first name only one unclaimed person has.
// Guesses, returned separately so they can be confirmed: a short form of a first name, then a shared opening.
export function linkNames(names, people) {
  const links = {}, guessed = [];
  const key = name => name.trim().toLowerCase().replace(/\s+/g, ' ');
  const first = person => key(person.first);
  const free = () => people.filter(person => person.first && !Object.values(links).includes(person.id));
  const open = () => names.filter(name => !(key(name) in links));
  const take = (name, hits, guess) => {
    if (hits.length !== 1) return;
    links[key(name)] = hits[0].id;
    if (guess) guessed.push(key(name));
  };
  for (const name of open()) {
    const parts = /^(.+)\s([a-z])\.?$/i.exec(name.trim());
    if (parts) take(name, free().filter(person => first(person) === key(parts[1]) && key(person.last).startsWith(parts[2].toLowerCase())));
  }
  for (const name of open()) take(name, free().filter(person => first(person) === key(name)));
  for (const name of open()) {
    if (key(name).length >= 3) take(name, free().filter(person => first(person).startsWith(key(name)) || key(name).startsWith(first(person))), true);
  }
  for (const name of open()) {
    if (key(name).length >= 3) take(name, free().filter(person => first(person).slice(0, 3) === key(name).slice(0, 3)), true);
  }
  return { links, guessed };
}
