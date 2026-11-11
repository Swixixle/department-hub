// Ask: answers from the app's own records. There is no language model here. A question is matched to a kind of lookup,
// the lookup runs on the schedule, the board, the directory, the person's own fairness sheet or the added documents,
// and the answer names where it came from. It matches supported question patterns rather than generating advice, and
// nothing leaves the device. When no matching record is found, it says so.
//
// A hosted model can be added later by handing it the records this module finds. It should never be handed more than
// the person asking is allowed to see, which is why the filtering happens here, before anything else.
import { holidays, staffing, statSheet } from './fairness.js';
import { addDays, normalizeName, shiftInterval, weekStart } from './model.js';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const weekday = date => new Date(date + 'T12:00:00Z').getUTCDay();
export const pretty = date => new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const shiftWord = shift => shift === 'N' ? 'night' : 'day';
const list = names => names.length < 3 ? names.join(' and ') : names.slice(0, -1).join(', ') + ' and ' + names.at(-1);
const same = (a, b) => normalizeName(a) === normalizeName(b);
const ROLES = { charge: 'charge', icu: 'ICU', extra: 'extra' };
const tagged = row => row.person + (row.role ? ' (' + (ROLES[row.role] || row.role) + ')' : '') + (row.hours ? ' ' + row.hours : '');

// The day or days a question is about, and day or night if it says. Returns null when it names no time.
export function parseWhen(text, today, rules = {}) {
  const q = ' ' + text.toLowerCase().replace(/[’]/g, "'") + ' ';
  const shift = /\b(tonight|nights?|overnight)\b/.test(q) ? 'N' : /\b(day shift|days|mornings?|daytime)\b/.test(q) ? 'D' : null;
  const year = Number(today.slice(0, 4));
  const one = (date, label) => {
    const parsed = new Date(date + 'T12:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return { invalid:true };
    return { from:date, to:date, shift, label:label || pretty(date) + (Number(date.slice(0, 4)) === year ? '' : ', ' + date.slice(0, 4)) };
  };
  const near = (month, day) => {                      // a month and day with no year: the one coming, or just past
    const date = y => y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    return date(year) < addDays(today, -60) ? date(year + 1) : date(year);
  };
  const dateIn = (y, month, day) => y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  const iso = q.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return one(iso[0]);
  const named = q.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
  if (named) return one(named[3] ? dateIn(named[3], MONTHS.indexOf(named[1]) + 1, Number(named[2])) : near(MONTHS.indexOf(named[1]) + 1, Number(named[2])));
  const slashed = q.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (slashed) return one(slashed[3] ? dateIn(slashed[3], Number(slashed[1]), Number(slashed[2])) : near(Number(slashed[1]), Number(slashed[2])));
  // Unticking a holiday changes fairness credit, not the calendar date named in a schedule question.
  const calendarRules = { ...rules, off:[] };
  const namedYear = q.match(/\b(\d{4})\b/), holidayYear = namedYear ? Number(namedYear[1]) : year;
  const calendar = [...holidays(holidayYear, calendarRules), ...holidays(holidayYear + 1, calendarRules)].filter(day => namedYear ? day.date.startsWith(namedYear[1] + '-') : day.date >= addDays(today, -1));
  const wanted = [['christmas eve', 'Christmas Eve'], ['christmas', 'Christmas Day'], ['thanksgiving', 'Thanksgiving'], ["new year's eve", "New Year's Eve"], ['new years eve', "New Year's Eve"],
    ['new year', "New Year's Day"], ['memorial day', 'Memorial Day'], ['labor day', 'Labor Day'], ['fourth of july', 'Independence Day'], ['4th of july', 'Independence Day'], ['independence day', 'Independence Day'],
    ...calendar.map(day => [day.name.toLowerCase(), day.name])].find(([words]) => q.includes(words));
  const holiday = wanted && calendar.find(day => day.name === wanted[1]);
  if (holiday) return one(holiday.date, holiday.name + ', ' + pretty(holiday.date) + (Number(holiday.date.slice(0, 4)) === year ? '' : ', ' + holiday.date.slice(0, 4)));
  if (/\btonight\b/.test(q)) return { ...one(today, 'tonight'), shift: 'N' };
  if (/\btomorrow\b/.test(q)) return one(addDays(today, 1), 'tomorrow');
  if (/\byesterday\b/.test(q)) return one(addDays(today, -1), 'yesterday');
  if (/\btoday\b/.test(q)) return one(today, 'today');
  const start = weekStart(today);
  if (/\bweekend\b/.test(q)) {
    const friday = addDays(start, weekday(today) === 0 ? -2 : 5), shiftBy = /\bnext weekend\b/.test(q) ? 7 : 0;
    return { from: addDays(friday, shiftBy), to: addDays(friday, shiftBy + 2), shift, label: shiftBy ? 'next weekend' : 'this weekend' };
  }
  if (/\bnext week\b/.test(q)) return { from: addDays(start, 7), to: addDays(start, 13), shift, label: 'next week' };
  if (/\bthis week\b/.test(q)) return { from: start, to: addDays(start, 6), shift, label: 'this week' };
  const day = DAYS.findIndex(name => new RegExp('\\b' + name.slice(0, 3) + '(' + name.slice(3) + ')?s?\\b').test(q));
  if (day >= 0) {
    let ahead = (day - weekday(today) + 7) % 7;
    if (ahead === 0 && /\bnext\b/.test(q)) ahead = 7;
    return one(addDays(today, ahead));
  }
  return shift ? { from: today, to: today, shift, label: 'today' } : null;
}

// Names from the roster that appear in the question, longest first so "Jordan K" wins over "Jordan".
export function findPeople(text, names) {
  let rest = ' ' + text.toLowerCase() + ' ';
  const found = [];
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp('(^|[^a-z])' + name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "(?:'s)?(?![a-z])");
    if (pattern.test(rest)) { found.push(name); rest = rest.replace(pattern, ' '); }
  }
  return found;
}

const STOP = new Set('the and for are was were with that this from have has had not but you your our out who what when where how does did can could should would there their they them then than into about any all its his her she him also may must shall will been being more most some such only over under per'.split(' '));
const terms = text => [...new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(word => !STOP.has(word)))];

// The passages of the added documents that best match a question. A passage is a paragraph, with the heading above it.
export function searchDocuments(question, documents = [], limit = 3) {
  const wanted = terms(question);
  if (!wanted.length) return [];
  const passages = [];
  for (const doc of documents) {
    let heading = '', at = 0;
    for (const block of String(doc.text || '').split(/\n\s*\n/)) {
      const text = block.trim(), offset = doc.text.indexOf(block, at);
      at = offset + block.length;
      if (!text) continue;
      const first = text.split('\n')[0];
      if (text.length < 90 && !/[.!?]$/.test(text)) { heading = text.replace(/\s+/g, ' '); continue; }       // a short line with no full stop is a heading
      if (first.length < 80 && !/[.!?:]$/.test(first) && text.includes('\n')) heading = first.trim();
      passages.push({ doc, heading, text, offset });
    }
  }
  const count = word => passages.filter(passage => passage.text.toLowerCase().includes(word) || passage.doc.title.toLowerCase().includes(word)).length;
  const weight = new Map(wanted.map(word => [word, Math.log(1 + passages.length / (1 + count(word)))]));
  return passages.map(passage => {
    const body = passage.text.toLowerCase(), where = (passage.doc.title + ' ' + passage.heading).toLowerCase();
    const hits = wanted.filter(word => body.includes(word) || where.includes(word));
    const score = hits.reduce((sum, word) => sum + weight.get(word) * (1 + Math.min(2, body.split(word).length - 1) / 2 + (where.includes(word) ? 1 : 0)), 0);
    return { ...passage, hits, score };
  }).filter(passage => passage.hits.length >= Math.min(2, wanted.length)).sort((a, b) => b.hits.length - a.hits.length || b.score - a.score).slice(0, limit);
}

const snippet = (text, words, length = 260) => {
  const flat = text.replace(/\s+/g, ' '), lower = flat.toLowerCase();
  const found = words.map(word => lower.indexOf(word)).filter(index => index >= 0), first = found.length ? Math.min(...found) : 0;
  const from = first < 60 ? 0 : flat.lastIndexOf(' ', first - 40) + 1;
  return (from ? '…' : '') + flat.slice(from, from + length) + (flat.length > from + length ? '…' : '');
};

// world: { today, now, actor, assignments, directory, people, links, posts, documents, releases, rules, keeper, seen,
//          published, requests }. Returns { title, lines, items: [{ text, sub, go }], source, empty }.
export function ask(question, world) {
  const q = ' ' + question.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim() + ' ';
  const { today, actor, assignments, posts = [], documents = [] } = world;
  const names = [...new Set(assignments.map(row => row.person))];
  const others = findPeople(q, names).filter(name => !same(name, actor));
  const when = parseWhen(q, today, world.rules);
  const scheduleSource = world.published ? 'The schedule, published ' + pretty(world.published.slice(0, 10)) : 'The sample schedule';
  const inRange = row => !when || (row.date >= when.from && row.date <= when.to && (!when.shift || row.shift === when.shift));
  const byTime = (a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift);
  const shiftsOf = name => assignments.filter(row => same(row.person, name)).sort(byTime);
  const now = Date.parse(world.now || '');
  const upcoming = row => Number.isFinite(now) ? shiftInterval(row)[0] >= now : row.date >= today;
  const nextShift = name => shiftsOf(name).find(upcoming);
  const on = (date, shift) => assignments.filter(row => row.date === date && row.shift === shift);
  const answer = (title, items, source, extra = {}) => ({ title, items, source, lines: [], empty: !items.length && !extra.lines?.length, ...extra });

  // Explicit document questions take precedence over words such as "due", "call" or "short" inside a policy title.
  if (/\b(polic(?:y|ies)|procedures?|protocols?|manuals?|guidelines?|handbook)\b/.test(q)) return documentAnswer();
  if (when?.invalid) return answer('That is not a valid date.', [], 'No schedule lookup was made.', { lines:['Use a date such as Nov 26, 2027.'], empty:true });

  // 1. How to reach someone.
  if (/\b(number|phone|call|text|reach|contact|cell)\b/.test(q) && others.length) {
    const items = others.map(name => {
      const person = (world.people || []).find(entry => entry.id === world.links?.[normalizeName(name)]);
      return { text: name + ': ' + (person?.cell ? person.cell.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1.$2.$3') : 'no number on record'), sub: person ? [person.first, person.last].filter(Boolean).join(' ') : 'Not matched to anyone in the Directory', go: 'people' };
    });
    return answer('From the Directory', items, 'The Directory in this workspace');
  }

  // 2. The person's own standing. Other people's numbers are for whoever keeps the record.
  if (/\b(my share|fair|fairness|how many (weekends?|holidays?|weekend turns)|weekends? (have|did|do) i|holidays? (have|did|do|am) i|am i (over|under|carrying)|carrying)\b/.test(q)) {
    if (others.length && !world.keeper) return answer('That is kept by whoever keeps the record', [], 'Fairness', { lines: ['You can see your own sheet. Other people’s numbers are shown only to the person who keeps the record.'], empty: false });
    const subject = world.keeper && others[0] || actor, sheet = statSheet(subject, { assignments, requests: world.requests, releases: world.releases, directory: world.directory, rules: world.rules }), row = sheet.row;
    if (!row) return answer('Nothing on the schedule for ' + subject, [], scheduleSource);
    const whose = same(subject, actor) ? 'you have' : subject + ' has', gap = row.weekendGap;
    const standing = gap === null ? '' : Math.abs(gap) < 1 ? ' That is within one turn of the share.' : ' That is ' + Math.abs(gap).toFixed(1) + (gap > 0 ? ' more than' : ' under') + ' the share of ' + row.weekendFair.toFixed(1) + '.';
    return answer('On this schedule, ' + whose + ' ' + row.weekend + ' weekend turns in ' + row.shifts + ' shifts.' + standing,
      [{ text: row.holidays.length ? 'Holidays: ' + row.holidays.join(', ') : 'No holidays on this schedule', sub: 'Charge ' + row.charge + ' · ICU ' + row.icu + ' · low-census hours ' + sheet.releasedHours, go: 'fairness' }], 'The Fairness record. ' + scheduleSource);
  }

  // 3. Shifts with more or fewer people than usual.
  if (/\b(short|short-staffed|understaffed|overstaffed|over-staffed|four (people|on)|extra (person|people)|low census|called off)\b/.test(q)) {
    const span = when || { from: today, to: addDays(today, 28), label: 'the next four weeks' };
    const listed = assignments.filter(row => row.date >= span.from && row.date <= span.to && (!span.shift || row.shift === span.shift));
    if (!listed.length) return answer('No matching shifts are on record, ' + span.label + '.', [], scheduleSource,
      { lines:['Missing schedule entries cannot establish whether staffing is normal.'], empty:true });
    const items = ['D', 'N'].filter(shift => !span.shift || span.shift === shift).flatMap(shift => { const usual = staffing(assignments, shift, world.directory); return [...usual.over, ...usual.short].map(item => ({ ...item, usual: usual.usual })); })
      .filter(item => item.date >= span.from && item.date <= span.to).sort(byTime)
      .map(item => ({ text: pretty(item.date) + ' ' + shiftWord(item.shift) + ': ' + item.people.length + ' listed, usual is ' + item.usual, sub: list(item.people), go: 'date|' + item.date }));
    return answer(items.length ? items.length + ' shift' + (items.length === 1 ? '' : 's') + ' off the usual number, ' + span.label : 'No listed shifts differ from their usual headcount, ' + span.label,
      items, scheduleSource + '. Usual means the most common headcount in this roster. Missing shifts cannot be checked; handwritten changes are not read.', { empty:false });
  }

  // 4. What is new on the board.
  if (/\b(miss(ed)?|what's new|whats new|anything new|news|announcements?|latest|new (posts?|messages?)|unread|catch me up|on the board)\b/.test(q)) {
    const fresh = posts.filter(post => post.created && (!world.seen || post.created > world.seen) && !same(post.author, actor));
    const shown = (fresh.length ? fresh : posts.filter(post => post.created)).slice(-6).reverse();
    return answer(fresh.length ? fresh.length + ' new on the board since you last looked' : 'Nothing new since you last looked. The latest:', shown.map(postItem), 'The board. Posts are from coworkers and are not policy.', { empty: !shown.length });
  }

  // 5. Things with a date: due dates, meetings, events.
  if (/\b(due|deadlines?|meetings?|events?|coming up|upcoming|calendar|need to (do|finish|complete))\b/.test(q)) {
    const mine = nextShift(actor), before = /before my next shift/.test(q) && mine ? mine.date : null;
    const kind = /\bmeetings?\b/.test(q) ? 'meeting' : /\b(due|deadlines?)\b/.test(q) ? 'due' : null;
    const dated = posts.filter(post => post.when?.date >= today && (!kind || post.when.kind === kind) && (!before || post.when.date <= before) && (!when || /before my next shift/.test(q) || (post.when.date >= when.from && post.when.date <= when.to)))
      .sort((a, b) => a.when.date.localeCompare(b.when.date));
    return answer(dated.length ? (kind === 'meeting' ? 'Meetings' : kind === 'due' ? 'Due' : 'Coming up') + (before ? ' before your next shift on ' + pretty(before) : '') : 'Nothing with a date is posted' + (before ? ' before your next shift on ' + pretty(before) : ''),
      dated.map(postItem), 'Dated posts on the board', { empty: false });
  }

  // 6. Who is on, or who the person is working with.
  if (/\b(who('s| is| are| all)? ?(is |are )?(on|working|scheduled|there)|work(ing)? with|who do i work)\b/.test(q)) {
    if (/\bwith\b/.test(q)) {
      const mine = shiftsOf(actor).filter(row => when ? inRange(row) : upcoming(row)).slice(0, when ? 4 : 1);
      if (!mine.length) return answer('You are not on the schedule ' + (when ? when.label : 'from today on'), [], scheduleSource);
      return answer('', mine.map(row => { const mates = on(row.date, row.shift).filter(mate => !same(mate.person, actor)); return { text: pretty(row.date) + ' ' + shiftWord(row.shift) + ': ' + (mates.length ? 'with ' + list(mates.map(tagged)) : 'nobody else is listed'), sub: row.role ? 'You are ' + (ROLES[row.role] || row.role) : '', go: 'date|' + row.date }; }), scheduleSource);
    }
    const span = when || { from: today, to: today, shift: null, label: 'today' };
    if (span.to > addDays(span.from, 3)) return answer('That is ' + span.label + '. Open the schedule to see each day.', [{ text: 'Open the schedule at ' + pretty(span.from), sub: '', go: 'date|' + span.from }], scheduleSource);
    const items = [];
    for (let date = span.from; date <= span.to; date = addDays(date, 1)) for (const shift of ['D', 'N']) if (!span.shift || span.shift === shift) {
      const rows = on(date, shift);
      items.push({ text: pretty(date) + ' ' + shiftWord(shift) + ': ' + (rows.length ? list(rows.map(tagged)) : 'nobody is listed'), sub: '', go: 'date|' + date });
    }
    return answer('', items, scheduleSource);
  }

  // 7. When someone works.
  if ((others.length && (when || /\b(work|works|working|shifts?|schedule|scheduled|on|off)\b/.test(q))) || /\b(when (do|does|am|is|are) (i|we)|next shift|(do|am) i (work|working|on|off)|my (shifts?|schedule)|working|on the schedule)\b/.test(q)) {
    const subject = others[0] || actor, whose = same(subject, actor) ? 'You' : subject, be = same(subject, actor) ? 'are' : 'is';
    if (when) {
      const rows = shiftsOf(subject).filter(inRange);
      return answer(rows.length ? whose + ' ' + be + ' on ' + when.label + ':' : whose + ' ' + be + ' not on the schedule ' + when.label + '.', rows.map(shiftItem), scheduleSource, { empty: false });
    }
    const coming = shiftsOf(subject).filter(upcoming).slice(0, 4);
    return answer(coming.length ? (same(subject, actor) ? 'Your' : subject + '’s') + ' next shift is ' + pretty(coming[0].date) + ', ' + shiftWord(coming[0].shift) + (coming[0].role ? ' (' + (ROLES[coming[0].role] || coming[0].role) + ')' : '') + '.' : whose + ' ' + be + ' not on the schedule from today on.',
      coming.map(shiftItem), scheduleSource, { empty: false });
  }

  // 8. Everything else: look in the added documents, then on the board.
  return documentAnswer();

  function documentAnswer() {
    const found = searchDocuments(q, documents), wanted = terms(q);
    const mentions = wanted.length ? posts.filter(post => post.body && wanted.filter(word => post.body.toLowerCase().includes(word)).length >= Math.min(2, wanted.length)).slice(-3).reverse() : [];
    if (found.length || mentions.length) {
      return answer(found.length ? 'From the documents the department has added' : 'Nothing in the documents. On the board:', [
        ...found.map(passage => ({ text: snippet(passage.text, passage.hits), sub: [passage.doc.title, passage.heading, passage.doc.kind, passage.doc.effective ? 'effective ' + passage.doc.effective : 'no effective date given'].filter(Boolean).join(' · '), go: 'doc|' + passage.doc.id + '|' + passage.offset })),
        ...mentions.map(post => ({ ...postItem(post), sub: 'A post on the board by ' + post.author + ', not policy' }))
      ], found.length ? 'Quoted from the document as added. Check its date, and ask the person responsible if it does not settle the question.' : 'The board. Posts are from coworkers and are not policy.');
    }
    return answer('Nothing on record answers that.', [], documents.length ? 'Searched the board and ' + documents.length + ' added document' + (documents.length === 1 ? '' : 's') : 'Searched the board. No documents have been added yet.',
      { empty: true, lines: ['Ask the person responsible, or put the question on the board so the answer is on record for everyone.'] });
  }

  function shiftItem(row) { return { text: pretty(row.date) + ', ' + shiftWord(row.shift) + (row.role ? ' (' + (ROLES[row.role] || row.role) + ')' : '') + (row.hours ? ' ' + row.hours : ''), sub: 'With ' + (list(on(row.date, row.shift).filter(mate => !same(mate.person, row.person)).map(mate => mate.person)) || 'nobody else listed'), go: 'date|' + row.date }; }
  function postItem(post) {
    const label = post.when ? ({ due: 'Due ', meeting: 'Meeting ', event: 'Event ' }[post.when.kind] || '') + pretty(post.when.date) + ': ' : '';
    return { text: label + (post.body ? post.body.slice(0, 140) + (post.body.length > 140 ? '…' : '') : post.voice ? 'Voice message' : 'A post with files'), sub: post.author + ' · ' + (post.created ? pretty(post.created.slice(0, 10)) : 'Sample announcement'), go: 'post|' + post.id };
  }
}

export const SUGGESTIONS = ['When do I work next?', 'Who am I working with on my next shift?', 'Who is on tonight?', 'What did I miss on the board?', 'What is coming up?', 'How many weekends have I worked?'];
