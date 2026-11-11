// Ask: answers from the app's own records. There is no language model here. A question is matched to a kind of lookup,
// the lookup runs on the schedule, the board, the directory, the person's own fairness sheet or the added documents,
// and the answer names where it came from. It matches supported question patterns rather than generating advice, and
// nothing leaves the device. When no matching record is found, it says so.
//
// A hosted model can be added later by handing it the records this module finds. It should never be handed more than
// the person asking is allowed to see, which is why the filtering happens here, before anything else.
import { holidays, isWeekendTurn, staffing, statSheet } from './fairness.js';
import { addDays, minutesByWeek, normalizeName, payWeekStart, shiftInterval, weekStart } from './model.js';
import { expand, keywords, nearest, qualifiers, stem, tidyQuestion } from './words.js';
import { checkExchange, describe, findOptions, shiftName, weekChanges } from './trades.js';

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
const MONTH_WORD = '(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)';
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NTH = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4 };
const COUNT = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fourteen: 14, 'couple of': 2, few: 3 };

// The day or days a question names. Returns { from, to, shift, label }, or null when it names none. A label reads
// naturally after "shifts" or "off": "next week", "in December", "from Dec 1 to Dec 7".
export function parseWhen(text, today, rules = {}) {
  const q = ' ' + text.toLowerCase().replace(/[’]/g, "'") + ' ';
  // "What days do I work" asks which days. "Days" means the day shift only where it is used that way.
  const shift = /\bdays (or|and|vs) nights\b|\bnights (or|and|vs) days\b/.test(q) ? null : /\b(tonight|nights?|overnight)\b/.test(q) ? 'N' :
    /\b(day shift|dayshift|mornings?|daytime)\b|\b(on|work|works|working|worked|short|cover|covering) days\b|\b([a-z]+day|tomorrow|(next|this|last) week(end)?) days?\b/.test(q) ? 'D' : null;
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  const dateIn = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  const lastOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const short = date => pretty(date).split(', ')[1];
  const one = (date, label) => {
    const parsed = new Date(date + 'T12:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return { invalid:true };
    return { from:date, to:date, shift, label:label || pretty(date) + (Number(date.slice(0, 4)) === year ? '' : ', ' + date.slice(0, 4)) };
  };
  const span = (from, to, label) => ({ from, to, shift, label });
  // "the week of Nov 15" is that whole week, not the one day
  const wide = found => {
    if (!found.from) return found;
    if (/\b(day|night|morning) (after|before)\b/.test(q)) return one(addDays(found.from, /\b(day|night|morning) after\b/.test(q) ? 1 : -1));
    if (/\bweekend of\b/.test(q)) { const friday = addDays(weekStart(found.from), weekday(found.from) === 0 ? -2 : 5); return span(friday, addDays(friday, 2), 'the weekend of ' + short(addDays(friday, 1))); }
    return /\bweek (of|with)\b|\b(christmas|thanksgiving|holiday) week\b/.test(q) ? span(weekStart(found.from), addDays(weekStart(found.from), 6), 'in the week of ' + pretty(weekStart(found.from))) : found;
  };
  const near = (m, day) => dateIn(dateIn(year, m, day) < addDays(today, -60) ? year + 1 : year, m, day);   // a month and day with no year: the one coming, or just past
  const monthNumber = word => MONTHS.indexOf(word.slice(0, 3)) + 1;
  const yearOf = m => m < month - 2 ? year + 1 : year;                 // a month named with no year: this year's, unless it is well behind us
  const wholeMonth = (y, m, label) => span(dateIn(y, m, 1), dateIn(y, m, lastOf(y, m)), label || 'in ' + MONTH_NAMES[m - 1] + (y === year ? '' : ' ' + y));
  const iso = q.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return wide(one(iso[0]));
  const named = q.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
  if (named) return wide(one(named[3] ? dateIn(named[3], monthNumber(named[1]), Number(named[2])) : near(monthNumber(named[1]), Number(named[2]))));
  const slashed = q.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  // "24/7", "50/50" and "20/20" are not dates. A date that cannot exist, such as 2/30 or 13/01, is still reported as invalid.
  const fraction = slashed && !slashed[3] && (slashed[0] === '24/7' || [slashed[1], slashed[2]].some(part => Number(part) < 1 || Number(part) > 31) || (Number(slashed[1]) > 12 && Number(slashed[2]) > 12));
  if (slashed && !fraction) return wide(one(slashed[3] ? dateIn(slashed[3], Number(slashed[1]), Number(slashed[2])) : near(Number(slashed[1]), Number(slashed[2]))));
  const nextMonth = month === 12 ? [year + 1, 1] : [year, month + 1];
  const nth = q.match(new RegExp('\\b(first|1st|second|2nd|third|3rd|fourth|4th|last) week (?:of|in) (?:(next month|this month)|' + MONTH_WORD + ')\\b'));
  if (nth) {
    const explicitYear = q.match(/\b(\d{4})\b/);
    const [y, m] = nth[2] === 'next month' ? nextMonth : nth[2] ? [year, month] : [explicitYear ? Number(explicitYear[1]) : yearOf(monthNumber(nth[3])), monthNumber(nth[3])];
    const from = nth[1] === 'last' ? lastOf(y, m) - 6 : (NTH[nth[1]] - 1) * 7 + 1, to = Math.min(from + 6, lastOf(y, m));
    return span(dateIn(y, m, from), dateIn(y, m, to), 'from ' + short(dateIn(y, m, from)) + ' to ' + short(dateIn(y, m, to)));
  }
  // Unticking a holiday changes fairness credit, not the calendar date named in a schedule question.
  const calendarRules = { ...rules, off:[] };
  const namedYear = q.match(/\b(\d{4})\b/) || (/\blast year\b/.test(q) ? [null, String(year - 1)] : /\bnext year\b/.test(q) ? [null, String(year + 1)] : null), holidayYear = namedYear ? Number(namedYear[1]) : year;
  const calendar = [...holidays(holidayYear, calendarRules), ...holidays(holidayYear + 1, calendarRules)].filter(day => namedYear ? day.date.startsWith(namedYear[1] + '-') : day.date >= addDays(today, -1));
  const wanted = [['christmas eve', 'Christmas Eve'], ['christmas', 'Christmas Day'], ['thanksgiving', 'Thanksgiving'], ["new year's eve", "New Year's Eve"], ['new years eve', "New Year's Eve"],
    ['new year', "New Year's Day"], ['memorial day', 'Memorial Day'], ['labor day', 'Labor Day'], ['fourth of july', 'Independence Day'], ['4th of july', 'Independence Day'], ['independence day', 'Independence Day'],
    ...calendar.map(day => [day.name.toLowerCase(), day.name])].find(([words]) => q.includes(words));
  const holiday = wanted && calendar.find(day => day.name === wanted[1]);
  if (holiday) return wide(one(holiday.date, holiday.name + ', ' + pretty(holiday.date) + (Number(holiday.date.slice(0, 4)) === year ? '' : ', ' + holiday.date.slice(0, 4))));
  // A month on its own is the whole month. "May" counts only as "in May", because it is also an ordinary word.
  const monthWord = [...q.matchAll(new RegExp('\\b(in |for |during |of )?' + MONTH_WORD + '\\b', 'g'))].find(found => found[2] !== 'may' || found[1]);
  if (monthWord) { const m = monthNumber(monthWord[2]), y = namedYear ? Number(namedYear[1]) : yearOf(m); return wholeMonth(y, m); }
  if (/\bnext month\b/.test(q)) return wholeMonth(...nextMonth, 'next month');
  if (/\blast month\b/.test(q)) return wholeMonth(...(month === 1 ? [year - 1, 12] : [year, month - 1]), 'last month');
  if (/\brest of (the|this) month\b/.test(q)) return span(today, dateIn(year, month, lastOf(year, month)), 'the rest of this month');
  if (/\bthis month\b/.test(q)) return wholeMonth(year, month, 'this month');
  // "the 19th" is the next 19th
  const ordinal = q.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/);
  if (ordinal && Number(ordinal[1]) >= 1 && Number(ordinal[1]) <= 31) {
    let [y, m] = Number(ordinal[1]) >= Number(today.slice(8, 10)) ? [year, month] : nextMonth;
    for (let tries = 0; tries < 3 && Number(ordinal[1]) > lastOf(y, m); tries++) [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
    return wide(one(dateIn(y, m, Number(ordinal[1]))));
  }
  if (/\blast night\b/.test(q)) return { ...one(addDays(today, -1), 'last night'), shift: 'N' };
  if (/\btonight\b/.test(q)) return { ...one(today, 'tonight'), shift: 'N' };
  if (/\bday after tomorrow\b/.test(q)) return one(addDays(today, 2));
  if (/\btomorrow\b/.test(q)) return one(addDays(today, 1), 'tomorrow');
  if (/\byesterday\b/.test(q)) return one(addDays(today, -1), 'yesterday');
  if (/\btoday\b/.test(q)) return one(today, 'today');
  const start = weekStart(today);
  const ahead = q.match(/\bnext (\d{1,2}|one|two|three|four|five|six|seven|ten|fourteen|couple of|few) (day|week)s?\b/);
  if (ahead) { const count = Math.min(60, Number(ahead[1]) || COUNT[ahead[1]]) * (ahead[2] === 'week' ? 7 : 1); return span(today, addDays(today, count - 1), 'in the next ' + count + ' days'); }
  if (/\brest of (the|this) week\b/.test(q)) return span(today, addDays(start, 6), 'the rest of this week');
  if (/\bweekend\b(?! (shifts?|turns?|rotation|agreement|polic|differential|pay))/.test(q)) {
    const friday = addDays(start, weekday(today) === 0 ? -2 : 5), shiftBy = /\bweekend after next\b/.test(q) ? 14 : /\bnext weekend\b/.test(q) ? 7 : /\b(last|past) weekend\b/.test(q) ? -7 : 0;
    return { from: addDays(friday, shiftBy), to: addDays(friday, shiftBy + 2), shift, label: shiftBy > 7 ? 'the weekend after next' : shiftBy > 0 ? 'next weekend' : shiftBy < 0 ? 'last weekend' : 'this weekend' };
  }
  if (/\bweek after next\b/.test(q)) return span(addDays(start, 14), addDays(start, 20), 'the week after next');
  if (/\bnext week\b/.test(q)) return span(addDays(start, 7), addDays(start, 13), 'next week');
  if (/\blast week\b/.test(q)) return span(addDays(start, -7), addDays(start, -1), 'last week');
  if (/\b(this|my) week\b/.test(q)) return span(start, addDays(start, 6), 'this week');
  const day = DAYS.findIndex(name => new RegExp('\\b' + name.slice(0, 3) + '(' + name.slice(3) + ')?s?\\b').test(q));
  if (day >= 0) {
    let offset = (day - weekday(today) + 7) % 7;
    if (offset === 0 && /\bnext\b/.test(q)) offset = 7;
    return { ...one(addDays(today, offset)), weekday: true };
  }
  return shift ? { from: today, to: today, shift, label: 'today', bare: true } : null;      // a shift was named and no day
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

// The passages of the added documents that best match a question. A passage is a paragraph, with the heading above it.
// Matching is on word stems, so endings do not matter. A word the documents do not contain is moved to the nearest one
// they do. The department's other words for a thing count too. Ranking is BM25, the measure search engines have used
// for decades: a rare word counts for more than a common one, and a long passage is not favoured for being long.
// `learned` holds passages people confirmed for earlier questions; a confirmed passage is lifted for a similar question.
export function passagesOf(documents = []) {
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
      const counts = new Map(), words = (text + ' ' + heading).toLowerCase().match(/[a-z0-9]{2,}/g) || [];
      for (const word of words) { const root = stem(word); counts.set(root, (counts.get(root) || 0) + 1); }
      passages.push({ doc, heading, text, offset, counts, length: words.length, title: new Set(keywords(doc.title)), lower: ' ' + text.toLowerCase().replace(/\s+/g, ' ') + ' ' });
    }
  }
  return passages;
}
export function searchDocuments(question, documents = [], limit = 3, learned = [], versions = {}) {
  const asked = keywords(question);
  if (!asked.length) return [];
  const passages = passagesOf(documents);
  if (!passages.length) return [];
  const vocabulary = new Set(passages.flatMap(passage => [...passage.counts.keys()]));
  const wanted = asked.map(word => vocabulary.has(word) ? word : (word.length > 3 && nearest(word, vocabulary)) || word);
  const others = expand(question).filter(term => !asked.includes(stem(term)));
  const average = passages.reduce((sum, passage) => sum + passage.length, 0) / passages.length;
  const rarity = term => { const n = passages.filter(passage => passage.counts.has(term)).length; return Math.log(1 + (passages.length - n + 0.5) / (n + 0.5)); };
  const weight = new Map(wanted.map(term => [term, rarity(term)]));
  const terms = keywords(question).join(' ');
  return passages.map(passage => {
    const hits = wanted.filter(term => passage.counts.has(term));
    const also = others.filter(term => term.includes(' ') ? passage.lower.includes(' ' + term) : passage.counts.has(stem(term)));
    let score = hits.reduce((sum, term) => { const tf = passage.counts.get(term); return sum + weight.get(term) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * passage.length / average)); }, 0) +
      also.length * 0.35 + wanted.filter(term => passage.title.has(term)).length * 0.3;      // the asked words themselves count for more than other words for them
    let lifted = 0;
    for (const link of learned) if (link.sourceHash && link.sourceHash === versions[passage.doc.id] && link.qualifiers === qualifiers(question) &&
      link.go === 'doc|' + passage.doc.id + '|' + passage.offset && overlap(link.terms, terms.split(' ')) >= 0.6) lifted += 2 * Math.min(3, link.count);
    return { ...passage, hits, also, score: score + lifted, lifted };
  }).filter(passage => passage.lifted || passage.hits.length >= Math.min(2, wanted.length) || (passage.hits.length + passage.also.length >= 2) || (wanted.length <= 2 && passage.also.length >= 1))
    .sort((a, b) => b.score - a.score).slice(0, limit);
}
// How much of the shorter list of stems is found in the other, allowing a near-miss spelling.
export function overlap(a, b) {
  if (!a.length || !b.length) return 0;
  const [small, large] = a.length <= b.length ? [a, b] : [b, a], pool = new Set(large);
  return small.filter(term => pool.has(term) || (term.length > 3 && nearest(term, pool))).length / small.length;
}
// An answer the department taught for a question like this one. With whole, only a question made of the same words
// counts: that is the test for letting a taught answer come before everything else.
export function matchTaught(question, answers = [], { whole = false, tidy = text => text } = {}) {
  const asked = keywords(question);
  let best = null;
  for (const answer of answers) for (const variant of answer.asks || []) {
    if (qualifiers(question) !== qualifiers(tidy(variant))) continue;
    const terms = keywords(tidy(variant)), shared = overlap(asked, terms);
    if (whole ? shared === 1 && asked.length === terms.length && asked.length > 0 :
      shared >= 0.6 && Math.min(asked.length, terms.length) * shared >= Math.min(2, terms.length)) if (!best || shared > best.shared) best = { answer, shared };
  }
  return best?.answer || null;
}

// A correction the record keeper reviewed for one question. It applies to that question, spelled out and tidied the
// same way, and to the same question about another person or day: the people, weekdays, numbers and months in it are
// blanks, so what was taught for "is Jordan free Friday" also reads "is Morgan free Saturday". It never applies to a
// question that merely shares its words: "who is off tonight" and "am I off tonight" share every keyword and ask
// different things.
const plain = text => text.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9'\/ -]/g, ' ').replace(/\s+/g, ' ').trim();
const BLANK_DAYS = new Set([...DAYS, 'today', 'tonight', 'tomorrow', 'yesterday']), MONTH_TOKEN = new RegExp('^' + MONTH_WORD + '$');
function shape(text, names) {
  let rest = ' ' + plain(text) + ' ';
  const people = findPeople(rest, names).map(name => ({ name, at: rest.indexOf(' ' + name.toLowerCase()) })).sort((a, b) => a.at - b.at), values = [];
  for (const { name } of people) rest = rest.replace(new RegExp('(^|[^a-z])' + name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "(?:'s)?(?![a-z])"), '$1{who}');
  let who = 0;
  const pattern = rest.trim().split(' ').map(token => {
    if (token === '{who}') { values.push(people[who++].name.toLowerCase()); return token; }
    const kind = BLANK_DAYS.has(token) ? '{day}' : /^\d+(st|nd|rd|th)?$/.test(token) ? '{n}' : MONTH_TOKEN.test(token) && token !== 'may' ? '{month}' : '';
    if (kind) values.push(token);
    return kind || token;
  }).join(' ');
  return { pattern, values };
}
// Returns { correction, reads } for a reading, with this question's people and days put into the taught wording, or
// { correction } for a chosen passage, which holds only for the very question it was chosen for.
export function matchCorrection(question, corrections = [], tidy = text => text, names = []) {
  const asked = shape(question, names);
  if (!asked.pattern) return null;
  for (const correction of corrections) for (const wording of correction.asks || []) {
    if (correction.people?.some(person => !names.some(name => same(name,person)))) continue;
    const taught = shape(tidy(wording), names);
    if (taught.pattern !== asked.pattern) continue;
    const identical = taught.values.every((value, index) => value === asked.values[index]);
    if (correction.go) { if (identical) return { correction }; continue; }
    if (identical) return { correction, reads: correction.reads };
    const swap = new Map(taught.values.map((value, index) => [value, asked.values[index]]));
    const keys = [...swap.keys()].sort((a, b) => b.length - a.length).map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return { correction, reads: plain(tidy(correction.reads)).replace(new RegExp("(?<![a-z0-9])(?:" + keys.join('|') + ")(?![a-z0-9])", 'g'), found => swap.get(found)) };
  }
  return null;
}
// Why a rewording cannot be saved as a correction, or '' when it can. A correction changes how a question is worded.
// It cannot bring in a person or a date the question did not have, so it cannot point everyone's question at one
// coworker or fix a relative question to one calendar date. The answer is computed from current records each time.
const DATE_MARK = /\d+|\b(?:jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\bin may\b|\b(?:christmas|thanksgiving|easter|new year|memorial day|labor day|independence day)\b/g;
const RELATIVE_MARK = /\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|today|tonight|tomorrow|yesterday|next|this|last|first|second|third|fourth|before|after|until|till|weeks?|weekends?|months?|years?)\b/g;
export function readingProblem(asked, reads, world) {
  const names = [...new Set(world.assignments.map(row => row.person))], tidy = text => tidyQuestion(text, names).text;
  const from = tidy(asked), to = tidy(reads);
  if (!plain(to)) return 'Type the wording first.';
  if (plain(from) === plain(to)) return 'That is the same wording.';
  const marks = text => [...findPeople(text,names), ...(text.match(DATE_MARK) || []), ...(text.match(RELATIVE_MARK) || [])];
  const had = new Set(marks(from)), wanted = new Set(marks(to));
  const added = [...wanted].filter(mark => !had.has(mark));
  if (added.length) return 'A correction can reword a question. It cannot add a person or a date the question did not have: ' + list(added) + '.';
  if ([...had].some(mark => !wanted.has(mark))) return 'Keep the same people and date scope in the rewording.';
  if ((parseWhen(from,world.today,world.rules)?.shift || null) !== (parseWhen(to,world.today,world.rules)?.shift || null))
    return 'Keep the same day or night scope in the rewording.';
  const result = ask(reads, { ...world, uncorrected: true, last: null });
  if (result.empty) return 'Ask has no answer for that wording either.';
  return '';
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
  const { today, actor, assignments, posts = [], documents:allDocuments = [] } = world;
  const documents = allDocuments.filter(doc => doc.status !== 'withdrawn' && (!doc.effective || doc.effective <= today));
  const names = [...new Set(assignments.map(row => row.person))];
  const familiar = new Set([...documents.map(doc => doc.title + ' ' + doc.text), ...posts.map(post => post.body || '')].flatMap(text => keywords(text)));
  const tidy = tidyQuestion(question, names, familiar);
  const q = ' ' + tidy.text.replace(/\s+/g, ' ').trim() + ' ';
  const tokens = new Set(q.trim().split(' ').map(stem)), has = (...words) => words.some(word => tokens.has(stem(word)));
  let others = findPeople(q, names).filter(name => !same(name, actor));
  let when = parseWhen(q, today, world.rules);
  // "Any days off before Thanksgiving", "my last shift before Christmas": from today up to the day before.
  if (when && !when.bare && when.from === when.to && when.from > today && / (before|until|till) /.test(q) && !/ before my next shift /.test(q) && !/ (day|night|morning) before /.test(q)) when = { from: today, to: addDays(when.from, -1), shift: null, label: 'before ' + when.label };
  // "How many shifts do I have left this month" counts from today.
  if (when && !when.bare && when.from < today && when.to >= today && / (left|remaining|to go) /.test(q)) when = { ...when, from: today, label: 'left ' + when.label };
  const self = has('i', 'me', 'my', 'am', 'mine');
  // A skills fair or a job fair is an event, not a question about fairness.
  const eventFair = / (skills?|competenc(y|ies)|job|career|health|wellness|benefits?|education|vendor|science|book|craft|county|state) fair /.test(q);
  const rosterWho = has('who') && (has('work', 'shift', 'schedule', 'on', 'with') || (when && !has('leave', 'vacation', 'pto', 'request', 'approve', 'approval')));
  // Getting off one of your own shifts, or picking one up. Both are worked out with the trade rules, not looked up.
  const pickUp = Boolean(world.trade) && self && !/ my /.test(q) && / (pick up|pickup|picking up|cover for|take over) /.test(q) && Boolean(when || others.length);
  // "Do I have Friday off" asks a fact. "I need Friday off" asks for a way out of the shift.
  const askedOff = /^ (do|does|did|will) (i|we) (have|get) /.test(q) || / how (many|much|long) /.test(q);
  const worksThen = Boolean(when && !when.bare) && assignments.some(row => same(row.person, actor) && row.date >= when.from && row.date <= when.to && (!when.shift || row.shift === when.shift));
  // "Is there anyone who could pick up the 19th": cover for the asker's own shift, when they have one then.
  const coverAsk = !others.length && has('who', 'anyone', 'anybody', 'someone', 'somebody') && / (pick up|pickup|cover|take|work) /.test(q) && / (can|could|able|willing|available|free) /.test(q);
  const whoCovers = Boolean(world.trade) && coverAsk && worksThen;
  const wantsOff = Boolean(world.trade) && self && !pickUp && (has('trade', 'swap', 'switch', 'cover', 'coverage') || / (take|taking|pick up|give away|giving up) my /.test(q) || (!askedOff && / (need|want|get|have) (\w+ ){0,3}off /.test(q)) || / (cannot|can not|unable to) (work|make|do|come) /.test(q)) && Boolean(when || has('next', 'shift'));
  const hoursAsk = (has('hour', 'hours', 'overtime') || / (over|under|at) \d{2} /.test(q)) && (self || others.length > 0) && !pickUp && !wantsOff;
  // "Which weekends am I on", "what weekends do I work in December": the weekend shifts only.
  const weekends = / (weekends|weekend (shifts?|turns?)) /.test(q) && (self || others.length > 0), leftAsk = / (left|remaining|to go) /.test(q);
  // "Am I off Friday", "what days am I off next week". Not "how do I get time off", which is a question for the documents.
  const offAsk = / off /.test(q) && (self || others.length > 0) && !wantsOff && !pickUp && !has('request', 'policy', 'pto', 'leave', 'vacation', 'census', 'time') && (!has('how') || / how (many|much|long) /.test(q));
  // "Am I charge this week", "who has charge tonight"
  const role = has('charge') ? 'charge' : has('icu') ? 'icu' : null;
  // "Who is off tonight", "is anyone off this weekend", "who is not working Friday": the people with no shift listed.
  // "Who could work Wednesday", from someone not on Wednesday, is the same list: it cannot say who is willing.
  const notListed = ((!self && !others.length && has('who', 'anyone', 'anybody', 'someone', 'somebody', 'everyone', 'everybody') && (/ (off|free|available) /.test(q) || / not (\w+ )?(work|working|on|scheduled|listed) /.test(q))) ||
    (coverAsk && !self && !worksThen && Boolean(when && !when.bare))) && !has('how', 'request', 'policy', 'pto', 'leave', 'vacation', 'census');
  // "How many in a row", "my longest stretch".
  const inARow = (/ in a row /.test(q) || / back to back /.test(q) || has('stretch', 'consecutive', 'straight')) && (self || others.length > 0);
  // "When was my last shift", "when did I last work".
  const lastWorked = (self || others.length > 0) && (/ (last|previous|most recent) (shift|time) /.test(q) || (/ last /.test(q) && has('was', 'did') && !/ last (week|weekend|month|night|year) /.test(q)));
  // "How long before the schedule do I ask for time off" is about the rules for leave, not about anyone's shifts. Leave is not recorded here.
  const leaveAsk = (/ time off /.test(q) || has('leave', 'vacation', 'pto')) && (has('how', 'request', 'ask', 'apply', 'approve', 'approval', 'deadline', 'before', 'ahead', 'long', 'far') || / put in /.test(q)) && !wantsOff && !offAsk && !notListed;
  // Which kind of question this is, from the words in it. Order matters: the more particular kinds come first.
  let kind = has('number', 'phone', 'call', 'text', 'reach', 'contact', 'cell') && others.length ? 'contact' :
    leaveAsk ? 'look' : hoursAsk ? 'hours' :
    has('fairness', 'unfair', 'share', 'carrying') || (has('fair') && !eventFair) || (has('many', 'much', 'count') && has('weekend', 'holiday', 'turn') && !(weekends && ((when && !when.bare) || leftAsk)) && !(has('holiday') && !has('weekend', 'turn'))) ? 'fair' :
    has('short', 'understaffed', 'overstaffed', 'census', 'four') || q.includes(' called off ') || (has('extra') && has('person', 'people')) ? 'staffing' :
    has('due', 'deadline', 'meeting', 'event', 'upcoming', 'calendar') || q.includes(' coming up ') ? 'dated' :
    / (miss|missed|news|latest|unread|announcements?|board) /.test(q) || / (is|anything) new /.test(q) || / new (post|message)/.test(q) ? 'news' :
    whoCovers ? 'trade' : notListed ? 'offlist' : pickUp ? 'pickup' : wantsOff ? 'trade' : offAsk ? 'off' : inARow ? 'run' : lastWorked && (!when || when.bare) ? 'when' :
    rosterWho || (has('with') && (self || when)) ? 'who' :
    weekends || (others.length && (when || has('work', 'shift', 'schedule', 'on', 'off', 'next'))) || (has('shift', 'schedule') && (self || others.length > 0 || Boolean(when))) || (has('work') && (self || when)) || (has('on', 'off') && self && when) || (has('next') && self) || (has('holiday') && (self || others.length > 0)) || (role && (self || others.length > 0)) || (when && self && / my (week|weekend|month) /.test(q)) || (when && self && tokens.size <= 5) ? 'when' : 'look';
  // A follow-up such as "and Saturday?" or "what about Avery?" keeps the last kind of question and changes one part.
  const last = world.last;
  // Scheduling uses calendar weeks; an hours question uses the configured pay week instead.
  if (kind === 'hours' && /\b(this|next|last) week\b/.test(q) && !/\b(rest of|week of)\b/.test(q)) {
    const offset = /\bnext week\b/.test(q) ? 7 : /\blast week\b/.test(q) ? -7 : 0;
    const from = addDays(payWeekStart(today, world.trade?.policy?.weekStartsOn || 0), offset);
    when = {...when,from,to:addDays(from,6)};
  }
  let followed = false;
  if (kind === 'look' && last?.kind && last.kind !== 'look' && (when || others.length) && tokens.size <= 6) {
    followed = true;
    kind = last.kind;
    if (!when) when = last.when || null;
    else if (when.bare && last.when) when = { ...last.when, shift:when.shift, bare:false };
    else if (!when.shift && last.when?.shift) when = { ...when, shift:last.when.shift };
    if (!others.length && last.others?.length) others = last.others;
    if (others.length && kind === 'who') kind = 'when';
  }
  const scheduleSource = world.published ? 'The schedule, published ' + pretty(world.published.slice(0, 10)) : 'The sample schedule';
  const inRange = row => !when || (row.date >= when.from && row.date <= when.to && (!when.shift || row.shift === when.shift));
  const byTime = (a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift);
  const shiftsOf = name => assignments.filter(row => same(row.person, name)).sort(byTime);
  const now = Date.parse(world.now || '');
  const upcoming = row => Number.isFinite(now) ? shiftInterval(row)[0] >= now : row.date >= today;
  const nextShift = name => shiftsOf(name).find(upcoming);
  const on = (date, shift) => assignments.filter(row => row.date === date && row.shift === shift);
  // A date the schedule does not cover is unknown, not a day without work.
  const recorded = new Set(assignments.map(row => row.date)), rosterFrom = [...recorded].sort()[0] || '', rosterTo = [...recorded].sort().at(-1) || '';
  const outside = range => !rosterFrom || range.to < rosterFrom || range.from > rosterTo;
  const partly = range => outside(range) ? [] : [...(range.from < rosterFrom ? ['The schedule on record starts ' + pretty(rosterFrom) + '. Earlier dates are not counted.'] : []), ...(range.to > rosterTo ? ['The schedule on record ends ' + pretty(rosterTo) + '. Later dates are not counted.'] : [])];
  const unknown = range => answer('No schedule entries are on record ' + (/^(in|from) /.test(range.label) ? '' : 'for ') + range.label.replace(/^left /, '') + '.', [], scheduleSource,
    { lines:[rosterFrom ? 'The schedule on record runs from ' + pretty(rosterFrom) + ' to ' + pretty(rosterTo) + '. A missing date cannot show whether anyone works.' : 'No schedule has been added.'], empty:true });
  // What the question was taken to be, in plain words, so a misreading shows at a glance.
  const understood = () => {
    const subject = others[0] || actor, you = same(subject, actor), span = when && !when.bare ? ', ' + when.label + (when.shift && !/night/.test(when.label) ? (when.shift === 'N' ? ', nights' : ', days') : '') : when?.bare ? ', ' + shiftWord(when.shift) + ' shift' : '';
    const what = { contact: 'how to reach ' + list(others), hours: (you ? 'your' : subject + '’s') + ' scheduled hours', fair: world.keeper && others[0] ? subject + '’s fairness record' : 'your fairness record',
      staffing: 'shifts with more or fewer people than usual', dated: 'dated posts on the board', news: 'what is new on the board', pickup: 'whether you could pick up a shift', trade: 'ways off one of your shifts',
      off: 'days ' + (you ? 'you are' : subject + ' is') + ' off', offlist: 'who has no shift listed', run: 'how many shifts in a row ' + (you ? 'you work' : subject + ' works'),
      who: has('with') || (followed && last?.withActor) ? 'who you are working with' : has('charge') ? 'who is marked charge' : has('icu') ? 'who is marked ICU' : 'who is on',
      when: 'when ' + (you ? 'you work' : subject + ' works'), look: 'a search of the documents and the board' }[kind];
    return what + (kind === 'look' || kind === 'news' ? '' : span);
  };
  const answer = (title, items, source, extra = {}) => ({ title, items, source, lines: [], empty: !items.length && !extra.lines?.length, kind, understood: understood(), read: tidy.changed ? tidy.text : '', changes: tidy.changes,
    context: { kind, when, others, withActor:kind === 'who' && (has('with') || (followed && Boolean(last?.withActor))) }, ...extra });
  const tidyText = text => tidyQuestion(text, names, familiar).text;
  const docQuestion = /\b(polic(?:y|ies)|procedures?|protocols?|manuals?|guidelines?|handbook)\b/.test(q);
  const taughtAnswers = (world.answers || []).filter(note => note.documentId
    ? Boolean(note.sourceHash && note.sourceHash === world.versions?.[note.documentId] && documents.some(doc => doc.id === note.documentId))
    : !docQuestion);
  const taughtAnswer = taught => answer('A custodian note, not official policy', [{ text: taught.answer,
    sub:'Recorded as ' + taught.by + ' on ' + pretty(taught.at.slice(0, 10)) + (taught.source ? ' · ' + taught.source : ''), go:'note|' + taught.id }],
    'Human-written guidance. The selected profile is not a verified identity; check the original source.', { taught:taught.id });

  // Corrections cannot bypass clarification or a restricted record.
  if (tidy.ambiguous.length) return answer('Which staff name did you mean?', [], 'No person lookup was made.',
    {lines:tidy.ambiguous.map(item => item.typed + ': ' + item.choices.join(' or ')),empty:true});
  if (when?.invalid) return answer('That is not a valid date.', [], 'No schedule lookup was made.', {lines:['Use a date such as Nov 26, 2027.'],empty:true});
  if (kind === 'fair' && others.length && !world.keeper) return answer('That is kept by whoever keeps the record', [], 'Fairness',
    {lines:['You can see your own sheet. Other people’s numbers are shown only to the person who keeps the record.'],empty:false});
  // A reviewed correction is labelled and revalidated against the current question before it runs.
  const fix = world.uncorrected ? null : matchCorrection(q, world.corrections, tidyText, names), correction = fix?.correction;
  if (fix?.reads && !readingProblem(q,fix.reads,world)) {
    const result = ask(fix.reads, { ...world, uncorrected: true });
    return { ...result, read: fix.reads, corrected: { id: correction.id, kind: 'reading', by: correction.by, at: correction.at } };
  }
  const chosen = correction?.go ? chosenPassage(correction) : null;
  if (chosen) return documentAnswer(chosen, correction);

  if (kind === 'who' && has('not', 'no', 'never', 'without')) return answer('Please clarify who you want listed.', [], scheduleSource,
    { lines:['Ask who is scheduled, or name a person and ask whether they work that date.'], empty:true });
  if (q.includes(' called off ') && !has('census', 'va')) return answer('Do you mean a low-census release?', [], 'Low census',
    { lines:['This app records low-census releases. It does not track staff calling in sick.'], empty:true });

  if (/ on call /.test(q) && !docQuestion && (self || others.length > 0 || has('who'))) return answer('On-call is not recorded here.', [], scheduleSource,
    { lines:['This schedule lists day and night shifts, and who is charge, ICU or extra. Ask whoever keeps the on-call list.'], empty:true, understood:'who is on call' });

  // Explicit document questions take precedence over words such as "due", "call" or "short" inside a policy title.
  if (docQuestion) return documentAnswer();

  // 1. How to reach someone.
  if (kind === 'contact') {
    const items = others.map(name => {
      const person = (world.people || []).find(entry => entry.id === world.links?.[normalizeName(name)]);
      return { text: name + ': ' + (person?.cell ? person.cell.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1.$2.$3') : 'no number on record'), sub: person ? [person.first, person.last].filter(Boolean).join(' ') : 'Not matched to anyone in the Directory', go: 'people' };
    });
    return answer('From the Directory', items, 'The Directory in this workspace');
  }

  // 2. The person's own standing. Other people's numbers are for whoever keeps the record.
  if (kind === 'fair') {
    if (others.length && !world.keeper) return answer('That is kept by whoever keeps the record', [], 'Fairness', { lines: ['You can see your own sheet. Other people’s numbers are shown only to the person who keeps the record.'], empty: false });
    const subject = world.keeper && others[0] || actor, sheet = statSheet(subject, { assignments, requests: world.requests, releases: world.releases, directory: world.directory, rules: world.rules }), row = sheet.row;
    if (!row) return answer('Nothing on the schedule for ' + subject, [], scheduleSource);
    const whose = same(subject, actor) ? 'you have' : subject + ' has', gap = row.weekendGap;
    const standing = gap === null ? '' : Math.abs(gap) < 1 ? ' That is within one turn of the share.' : ' That is ' + Math.abs(gap).toFixed(1) + (gap > 0 ? ' more than' : ' under') + ' the share of ' + row.weekendFair.toFixed(1) + '.';
    return answer('On this schedule, ' + whose + ' ' + row.weekend + ' weekend turns in ' + row.shifts + ' shifts.' + standing,
      [{ text: row.holidays.length ? 'Holidays: ' + row.holidays.join(', ') : 'No holidays on this schedule', sub: 'Charge ' + row.charge + ' · ICU ' + row.icu + ' · low-census hours ' + sheet.releasedHours, go: 'fairness' }], 'The Fairness record. ' + scheduleSource);
  }

  // 3. Shifts with more or fewer people than usual.
  if (kind === 'staffing') {
    const span = when && !when.bare ? when : { from: today, to: addDays(today, 28), shift: when?.shift || null, label: 'the next four weeks' };
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
  if (kind === 'news') {
    const fresh = posts.filter(post => post.created && (!world.seen || post.created > world.seen) && !same(post.author, actor));
    const shown = (fresh.length ? fresh : posts.filter(post => post.created)).slice(-6).reverse();
    return answer(fresh.length ? fresh.length + ' new on the board since you last looked' : 'Nothing new since you last looked. The latest:', shown.map(postItem), 'The board. Posts are from coworkers and are not policy.', { empty: !shown.length });
  }

  // 5. Things with a date: due dates, meetings, events.
  if (kind === 'dated') {
    const mine = nextShift(actor), before = /before my next shift/.test(q) && mine ? mine.date : null;
    const sort = has('meeting') ? 'meeting' : has('due', 'deadline') ? 'due' : null;
    const dated = posts.filter(post => post.when?.date >= today && (!sort || post.when.kind === sort) && (!before || post.when.date <= before) && (!when || /before my next shift/.test(q) || (post.when.date >= when.from && post.when.date <= when.to)))
      .sort((a, b) => a.when.date.localeCompare(b.when.date));
    return answer(dated.length ? (sort === 'meeting' ? 'Meetings' : sort === 'due' ? 'Due' : 'Coming up') + (before ? ' before your next shift on ' + pretty(before) : '') : 'Nothing with a date is posted' + (before ? ' before your next shift on ' + pretty(before) : ''),
      dated.map(postItem), 'Dated posts on the board', { empty: false });
  }

  // Ways off one of the person's own shifts.
  const tradeSource = 'Worked out from the schedule and the trade rules entered. It does not know who is willing or who is on leave.';
  if (kind === 'trade') {
    const ahead = shiftsOf(actor).filter(row => row.date >= today);
    // "My Thursday" is the next Thursday the person works, not necessarily this week's.
    const target = ahead.find(row => when && !when.bare ? inRange(row) : upcoming(row) && (!when?.shift || row.shift === when.shift)) ||
      (when?.weekday ? ahead.find(row => new Date(row.date + 'T12:00:00Z').getUTCDay() === new Date(when.from + 'T12:00:00Z').getUTCDay() && (!when.shift || row.shift === when.shift)) : null);
    if (!target) return answer('You are not on the schedule ' + (when && !when.bare ? when.label : 'from today on') + '.', [], scheduleSource, { empty: false });
    when = {from:target.date,to:target.date,shift:target.shift,label:pretty(target.date)};
    const found = findOptions({ ...world.trade, target }), some = (n, one, many) => n ? n + ' ' + (n === 1 ? one : many) : '';
    if (found.blockedForMe.length) return answer(shiftName(target) + ' cannot be offered.', [{ text: found.blockedForMe.join(' '), sub: '', go: 'date|' + target.date }], tradeSource, { empty: false });
    // Unless cover is asked for, a trade means keeping your hours: swaps inside the pay week come first.
    const cover = whoCovers || has('cover', 'coverage') || / (take|taking|pick up) my /.test(q), kept = found.counts.keep + found.counts.keepLoops;
    // "Can Avery cover my Saturday": that one person first, checked the same way.
    const named = others[0] ? checkExchange({ ...world.trade, moves: [{ key: target.key, to: others[0] }] }) : null, part = named?.people.find(entry => same(entry.person, others[0]));
    const namedItem = named ? [{ text: others[0] + ' taking it ' + (named.status === 'blocked' ? 'does not pass the rules entered.' : named.status === 'check' ? 'passes, with something to check.' : 'passes the rules entered.') + ' ' +
      [...(part?.problems || []), ...(part?.cautions || [])].join(' '), sub: part ? others[0] + '’s hours: ' + (weekChanges(part) || 'no change') + '.' : '', go: 'options|' + target.key }] : [];
    const counted = [kept ? some(found.counts.keep, 'swap keeps', 'swaps keep') + (found.counts.keep && found.counts.keepLoops ? ' and ' : '') + some(found.counts.keepLoops, 'three-person exchange keeps', 'three-person exchanges keep') + ' everyone’s weekly hours' : 'nothing left in that pay week keeps everyone’s hours',
      some(found.counts.swaps, 'swap moves hours between weeks', 'swaps move hours between weeks'), some(found.counts.pickups, 'person could cover it', 'people could cover it')].filter(Boolean);
    const order = cover ? [['pickups', 2], ['chains', 1], ['keep', 1], ['keepLoops', 1]] : [['keep', 2], ['keepLoops', 1], ['swaps', 1], ['pickups', 1]];
    const items = order.flatMap(([group, take]) => found[group].slice(0, take)).map(option => {
      const lines = describe(option, actor), split = lines.findIndex(line => /^(Hours|Nobody)/.test(line));
      return { text: lines.slice(0, split).join(' '), sub: [lines[split], ...option.cautions].join(' '), go: 'options|' + target.key };
    });
    const first = (cover ? found.pickups[0] : found.keep[0] || found.swaps[0])?.moves[0].to;
    return answer('For ' + shiftName(target) + ': ' + counted.join(', ') + '.',
      namedItem.length || items.length ? [...namedItem, ...(namedItem.length ? items.slice(0, 2) : items)] : [{ text: 'Open the shift to look for other three-person exchanges', sub: '', go: 'options|' + target.key }], tradeSource,
      { empty: false, next: [(others[0] || first) && 'How do I reach ' + (others[0] || first) + '?', 'How many hours do I have that week?'].filter(Boolean) });
  }
  // Picking up a shift: would the rules allow it, and what would it do to the week.
  if (kind === 'pickup') {
    const mine = shiftsOf(actor), usual = mine.filter(row => row.shift === 'N').length * 2 > mine.length ? 'N' : 'D', span = when && !when.bare ? when : null;
    const target = assignments.filter(row => !same(row.person, actor) && row.date >= today && (!span || (row.date >= span.from && row.date <= span.to)) && row.shift === (when?.shift || usual) &&
      (!others.length || others.some(name => same(name, row.person)))).sort(byTime)[0];
    if (!target) return answer('Nobody is listed on a shift you could pick up ' + (span ? span.label : 'from today on') + '.', [], scheduleSource, { empty: false });
    if (on(target.date, target.shift).some(row => same(row.person, actor))) return answer('You are already on ' + shiftName(target) + '.', [], scheduleSource, { empty: false });
    const result = checkExchange({ ...world.trade, moves: [{ key: target.key, to: actor }] }), me = result.people.find(part => same(part.person, actor)) || { weeks: [], problems: [], cautions: [], notes: [] };
    const said = [...me.problems, ...me.cautions, ...me.notes].map(text => text.replace(new RegExp('^' + actor + ' would'), 'You would'));
    return answer('Picking up ' + shiftName(target) + (result.status === 'blocked' ? ' does not pass the rules entered.' : result.status === 'check' ? ' passes, with something to check.' : ' passes the rules entered.'),
      [{ text: ['Your hours: ' + (weekChanges(me) || 'no change') + '.', ...said].join(' '), sub: 'On that shift now: ' + list(on(target.date, target.shift).map(tagged)), go: 'date|' + target.date }], tradeSource,
      { empty: false, next: ['When do I work next?', 'How many weekends have I worked?'] });
  }

  // Scheduled hours by pay week.
  if (kind === 'hours') {
    const subject = others[0] || actor, mine = same(subject, actor), policy = world.trade?.policy || {}, startDay = policy.weekStartsOn || 0, limit = policy.overtimeLimitMinutes || 0;
    // "Am I over 40 any week": every week the schedule on record still has ahead.
    const everyWeek = / (any|which|what|every|each) weeks? /.test(q) && rosterTo >= today;
    const base = everyWeek ? { from: today, to: rosterTo } : last?.kind === 'trade' && last.when && !when ? last.when : when;                       // "that week" after a trade question
    const range = base && !base.bare ? base : { from: today, to: today }, totals = new Map(), listed = new Map(), tell = minutes => String(Math.round(minutes / 6) / 10);
    const hoursRoster = world.trade?.roster || assignments;
    for (const row of hoursRoster.filter(row => same(row.person,subject))) for (const [week, minutes] of minutesByWeek(row, startDay)) { totals.set(week, (totals.get(week) || 0) + minutes); listed.set(week, [...(listed.get(week) || []), row]); }
    const items = [];
    for (let week = payWeekStart(range.from, startDay); week <= payWeekStart(range.to, startDay) && items.length < (everyWeek ? 12 : 8); week = addDays(week, 7)) {
      const minutes = totals.get(week) || 0;
      items.push({ text: 'Week of ' + pretty(week) + ': ' + tell(minutes) + ' hours' + (limit && minutes > limit ? ', ' + tell(minutes - limit) + ' over the limit entered' : ''),
        sub: (listed.get(week) || []).map(row => pretty(row.date).split(', ')[1] + (row.shift === 'N' ? ' night' : ' day')).join(', ') || 'No shifts', go: 'date|' + week });
    }
    const over = items.filter(item => / over the limit entered$/.test(item.text));
    return answer(everyWeek && limit ? (over.length ? (mine ? 'You are' : subject + ' is') + ' over the limit entered in ' + over.length + ' of the ' + items.length + ' weeks left on this schedule:' : 'No week left on this schedule is over the limit entered for ' + (mine ? 'you' : subject) + '.') :
      items.length === 1 ? (mine ? 'You are' : subject + ' is') + ' scheduled for ' + tell(totals.get(payWeekStart(range.from, startDay)) || 0) + ' hours in the week of ' + pretty(payWeekStart(range.from, startDay)) + '.' : (mine ? 'Your' : subject + '’s') + ' scheduled hours, week by week:',
      everyWeek && limit && over.length ? over : items, scheduleSource + '. Hours are from this schedule' + (world.trade?.roster ? ' with agreed changes applied' : '') + ' only; missing entries and unrecorded pickups are not counted. The pay week starts on ' + DAYS[startDay][0].toUpperCase() + DAYS[startDay].slice(1) + (limit ? ' and the limit entered is ' + tell(limit) + ' hours.' : '.'),
      { empty: false, next: mine && world.trade ? ['Who can I trade my next shift with?'] : [] });
  }
  // Days off.
  if (kind === 'off') {
    const subject = others[0] || actor, mine = same(subject, actor), worked = new Set(shiftsOf(subject).filter(row => !when?.shift || row.shift === when.shift).map(row => row.date));
    const range = when && !when.bare ? when : { from: today, to: addDays(today, 13), label: 'in the next 14 days' };
    const known = new Set(assignments.filter(row => !when?.shift || row.shift === when.shift).map(row => row.date));
    const note = scheduleSource + '. A night shift is counted on the day it starts. Off means no shift is listed for this person on a recorded date; missing pages and handwritten changes cannot be checked.';
    // "When is my next weekend off": the first weekends with no shift from Friday night through Sunday night.
    if (/ weekends? off /.test(q) && has('next', 'when', 'which', 'what') && !/ (this|last) weekend /.test(q)) {
      const friday = addDays(weekStart(today), weekday(today) === 0 ? -2 : 5), free = [];
      for (let week = 0; week < 16 && free.length < 3; week++) {
        const from = addDays(friday, week * 7), to = addDays(from, 2);
        if (to < today || ![from, addDays(from, 1), to].every(date => known.has(date))) continue;
        if (!shiftsOf(subject).some(row => row.date >= from && row.date <= to && isWeekendTurn(row))) free.push({ from, to });
      }
      return answer(free.length ? (mine ? 'Your' : subject + '’s') + ' next weekend off is ' + pretty(free[0].from) + ' to ' + pretty(free[0].to) + '.' : 'No weekend off is on the schedule on record for ' + (mine ? 'you' : subject) + '.',
        free.map(run => ({ text: pretty(run.from) + ' to ' + pretty(run.to), sub: 'No shift from Friday night through Sunday night', go: 'date|' + run.from })), note,
        { empty: false, lines: rosterTo ? ['The schedule on record ends ' + pretty(rosterTo) + '.'] : [], understood: 'the next weekends ' + (mine ? 'you are' : subject + ' is') + ' off' });
    }
    if (range.from === range.to) {
      if (!known.has(range.from)) return answer('No schedule entries are on record for ' + range.label + '.', [], note,
        {lines:['A missing date cannot establish that someone is off.'],empty:true});
      const rows = shiftsOf(subject).filter(row => row.date === range.from && (!range.shift || row.shift === range.shift));
      return answer(rows.length ? 'No. ' + (mine ? 'You work ' : subject + ' works ') + range.label + ':' : 'Yes. ' + (mine ? 'You are' : subject + ' is') + ' off ' + range.label + '.', rows.map(shiftItem), note, { empty: false });
    }
    // "Do I have this weekend off": yes or no first, then the shifts in the way.
    if (/^ (am|is|are|do|does|did|will|was|were) /.test(q) && range.to <= addDays(range.from, 2)) {
      const days = [range.from, addDays(range.from, 1), addDays(range.from, 2)].filter(date => date <= range.to), unknown = days.filter(date => !known.has(date));
      if (unknown.length === days.length) return answer('No schedule entries are on record for ' + range.label + '.', [], note, { lines:['A missing date cannot establish that someone is off.'], empty:true });
      const rows = shiftsOf(subject).filter(row => row.date >= range.from && row.date <= range.to && (!range.shift || row.shift === range.shift)), free = days.filter(date => known.has(date) && !worked.has(date));
      if (!rows.length && unknown.length) return answer('The full ' + range.label + ' is not on record, so I cannot confirm it is off.', [], note,
        {empty:true,lines:[unknown.length + ' of those dates are missing from this roster.']});
      return answer(rows.length ? 'No. ' + (mine ? 'You work ' : subject + ' works ') + rows.length + ' shift' + (rows.length === 1 ? '' : 's') + ' ' + range.label + '.' : 'Yes. ' + (mine ? 'You are' : subject + ' is') + ' off ' + range.label + '.', rows.map(shiftItem), note,
        { empty:false, lines:[...(rows.length && free.length ? [(mine ? 'You are' : subject + ' is') + ' off ' + list(free.map(pretty)) + '.'] : []), ...(unknown.length ? [unknown.length + ' of those dates are missing from this roster.'] : [])] });
    }
    const runs = []; let missing = 0;
    for (let date = range.from; date <= range.to && runs.length < 40; date = addDays(date, 1)) {
      if (!known.has(date)) { missing++; continue; }
      if (worked.has(date)) continue;
      const open = runs.at(-1);
      if (open && addDays(open.to, 1) === date) open.to = date; else runs.push({ from: date, to: date });
    }
    const days = runs.reduce((sum, run) => sum + Math.round((Date.parse(run.to) - Date.parse(run.from)) / 864e5) + 1, 0);
    if (!days && missing) return answer('No recorded days off can be established ' + range.label + '.', [], note,
      {lines:[missing + ' dates are missing from this roster.'],empty:true});
    return answer((mine ? 'You are' : subject + ' is') + ' off ' + days + ' recorded day' + (days === 1 ? '' : 's') + ' ' + range.label + (runs.length ? ':' : '.'),
      runs.map(run => ({ text: run.from === run.to ? pretty(run.from) : pretty(run.from) + ' to ' + pretty(run.to), sub: run.from === run.to ? '' : Math.round((Date.parse(run.to) - Date.parse(run.from)) / 864e5) + 1 + ' days', go: 'date|' + run.from })), note,
      {empty:false,lines:missing ? [missing + ' dates are missing and were not counted as days off.'] : []});
  }

  // Who has no shift listed.
  if (kind === 'offlist') {
    const span = when && !when.bare ? when : { from: today, to: today, label: 'today' };
    if (span.to > addDays(span.from, 3)) return answer('That is ' + span.label + '. Open the schedule to see each day.', [{ text: 'Open the schedule at ' + pretty(span.from), sub: '', go: 'date|' + span.from }], scheduleSource);
    const items = [];
    for (let date = span.from; date <= span.to; date = addDays(date, 1)) {
      const rows = assignments.filter(row => row.date === date && (!span.shift || row.shift === span.shift)), working = new Set(rows.map(row => normalizeName(row.person))), free = names.filter(name => !working.has(normalizeName(name))).sort();
      items.push(rows.length ? { text: pretty(date) + ': ' + (free.length ? list(free) : 'everyone is listed'), sub: free.length + ' of ' + names.length + ' people have no ' + (span.shift ? shiftWord(span.shift) + ' shift listed; they may have another shift that day' : 'shift that day, day or night'), go: 'date|' + date } :
        { text: pretty(date) + ': no schedule entries are on record', sub: 'A missing date cannot establish that anyone is off', go: 'date|' + date });
    }
    return answer('No shift listed ' + span.label + ':', items, scheduleSource + '. No shift listed is not the same as free or willing: leave, other jobs and handwritten changes are not recorded here.', { empty: false });
  }
  // How many shifts in a row.
  if (kind === 'run') {
    const subject = others[0] || actor, mine = same(subject, actor), runs = [];
    for (const date of [...new Set(shiftsOf(subject).map(row => row.date))]) { const open = runs.at(-1); if (open && addDays(open.to, 1) === date) { open.to = date; open.count++; } else runs.push({ from: date, to: date, count: 1 }); }
    const range = when && !when.bare && when.from !== when.to ? when : { from: today, to: addDays(today, 27), label: 'in the next four weeks' };
    const within = runs.filter(run => run.to >= range.from && run.from <= range.to), longest = within.reduce((best, run) => !best || run.count > best.count ? run : best, null), cap = world.trade?.policy?.maxInARow || 0;
    if (!longest) return answer((mine ? 'You have' : subject + ' has') + ' no shifts ' + range.label + '.', [], scheduleSource, { empty: false });
    return answer((mine ? 'Your' : subject + '’s') + ' longest stretch ' + range.label + ' is ' + longest.count + ' in a row' + (longest.count > 1 ? ', ' + pretty(longest.from) + ' to ' + pretty(longest.to) : '') + '.' + (cap && longest.count > cap ? ' The trade rules entered warn above ' + cap + '.' : ''),
      within.map(run => ({ text: run.count === 1 ? pretty(run.from) : pretty(run.from) + ' to ' + pretty(run.to), sub: run.count === 1 ? '1 shift' : run.count + ' in a row', go: 'date|' + run.from })),
      scheduleSource + '. A night shift is counted on the day it starts. Days are in a row when the dates follow each other.', { empty: false });
  }

  // 6. Who is on, or who the person is working with.
  if (kind === 'who') {
    if (has('with') || (followed && last?.withActor)) {
      if (when && !when.bare && outside(when)) return unknown(when);
      const together = row => others.some(name => on(row.date, row.shift).some(mate => same(mate.person, name)));
      if (others.length) {
        const range = when && !when.bare ? when : { from: today, to: addDays(today, 55), label: 'in the next eight weeks' };
        const shared = shiftsOf(actor).filter(row => row.date >= range.from && row.date <= range.to && (!range.shift || row.shift === range.shift) && together(row));
        return answer('You and ' + list(others) + (range.to < today ? ' were' : ' are') + ' on together ' + (shared.length || 'no') + ' time' + (shared.length === 1 ? '' : 's') + ' ' + range.label + (shared.length ? ':' : '.'), shared.map(shiftItem), scheduleSource,
          { empty: false, lines: partly(range), understood: 'the shifts you share with ' + list(others) + ', ' + range.label });
      }
      const mine = shiftsOf(actor).filter(row => when ? inRange(row) : upcoming(row)).slice(0, when ? 4 : 1);
      if (!mine.length) return answer('You are not on the schedule ' + (when ? when.label : 'from today on'), [], scheduleSource);
      return answer('', mine.map(row => { const mates = on(row.date, row.shift).filter(mate => !same(mate.person, actor)); return { text: pretty(row.date) + ' ' + shiftWord(row.shift) + ': ' + (mates.length ? 'with ' + list(mates.map(tagged)) : 'nobody else is listed'), sub: row.role ? 'You are ' + (ROLES[row.role] || row.role) : '', go: 'date|' + row.date }; }), scheduleSource);
    }
    const span = when || { from: today, to: today, shift: null, label: 'today' };
    if (span.to > addDays(span.from, 3)) return answer('That is ' + span.label + '. Open the schedule to see each day.', [{ text: 'Open the schedule at ' + pretty(span.from), sub: '', go: 'date|' + span.from }], scheduleSource);
    if (outside(span)) return unknown(span);
    const items = [];
    for (let date = span.from; date <= span.to; date = addDays(date, 1)) for (const shift of ['D', 'N']) if (!span.shift || span.shift === shift) {
      const rows = on(date, shift), marked = rows.filter(row => row.role === role);
      items.push(role ? { text: pretty(date) + ' ' + shiftWord(shift) + ': ' + (marked.length ? list(marked.map(row => row.person)) : 'nobody is marked ' + ROLES[role]), sub: rows.length ? 'On that shift: ' + list(rows.map(tagged)) : recorded.has(date) ? 'Nobody is listed' : 'No schedule entries are on record for that date', go: 'date|' + date } :
        { text: pretty(date) + ' ' + shiftWord(shift) + ': ' + (rows.length ? list(rows.map(tagged)) : recorded.has(date) ? 'nobody is listed' : 'no schedule entries are on record'), sub: '', go: 'date|' + date });
    }
    return answer(role ? 'Marked ' + ROLES[role] + ':' : '', items, scheduleSource);
  }

  // 7. When someone works.
  if (kind === 'when') {
    const subject = others[0] || actor, whose = same(subject, actor) ? 'You' : subject, mine = same(subject, actor), past = Boolean(when && !when.bare && when.to < today);
    const be = mine ? (past ? 'were' : 'are') : past ? 'was' : 'is', have = mine ? (past ? 'You had ' : 'You have ') : subject + (past ? ' had ' : ' has ');
    const kindOf = when?.shift ? (when.shift === 'N' ? 'night ' : 'day ') : '';
    if (lastWorked && (!when || when.bare)) {
      const before = shiftsOf(subject).filter(row => !upcoming(row)), recent = before.at(-1);
      return answer(recent ? (mine ? 'Your' : subject + '’s') + ' last shift was ' + pretty(recent.date) + ', ' + shiftWord(recent.shift) + (recent.role ? ' (' + (ROLES[recent.role] || recent.role) + ')' : '') + '.' : 'No earlier shift is on this schedule for ' + (mine ? 'you' : subject) + '.',
        before.slice(-3).reverse().map(shiftItem), scheduleSource, { empty: false, understood: 'the last shift ' + (mine ? 'you' : subject) + ' worked' });
    }
    // "When do I work again after tonight"
    if (when && !when.bare && / (after|following) /.test(q) && !/ (day|night|morning) after | after next /.test(q)) {
      const later = shiftsOf(subject).filter(row => row.date > when.to).slice(0, 4), point = when.from === when.to ? when.label : pretty(when.to);
      return answer(later.length ? (mine ? 'Your' : subject + '’s') + ' next shift after ' + point + ' is ' + pretty(later[0].date) + ', ' + shiftWord(later[0].shift) + '.' : whose + ' ' + (mine ? 'are' : 'is') + ' not on the schedule after ' + point + '.',
        later.map(shiftItem), scheduleSource, { empty: false, understood: 'when ' + (mine ? 'you work' : subject + ' works') + ' after ' + point });
    }
    if (when && !when.bare && outside(when)) return unknown(when);
    // "Am I charge this week", "when is Avery in the ICU next"
    if (role) {
      const range = when && !when.bare ? when : { from: today, to: addDays(today, 55), label: 'in the next eight weeks' };
      const all = shiftsOf(subject).filter(row => row.date >= range.from && row.date <= range.to && (!range.shift || row.shift === range.shift)), marked = all.filter(row => row.role === role);
      return answer((mine ? 'You ' + be : subject + ' ' + be) + ' marked ' + ROLES[role] + ' on ' + (marked.length || 'none') + ' of ' + all.length + ' shift' + (all.length === 1 ? '' : 's') + ' ' + range.label + (marked.length ? ':' : '.'), marked.map(shiftItem), scheduleSource,
        { empty: false, lines: partly(range), understood: 'when ' + (mine ? 'you are' : subject + ' is') + ' marked ' + ROLES[role] + ', ' + range.label });
    }
    // "Which holidays do I work": every holiday the schedule on record covers, worked or not.
    if (has('holiday') && (!when || when.bare || when.from !== when.to) && rosterFrom) {
      const range = when && !when.bare ? { ...when, from: when.from < rosterFrom ? rosterFrom : when.from, to: when.to > rosterTo ? rosterTo : when.to } : { from: rosterFrom, to: rosterTo, label: 'on this schedule' };
      const days = [Number(range.from.slice(0, 4)), Number(range.to.slice(0, 4))].filter((year, index, years) => years.indexOf(year) === index).flatMap(year => holidays(year, world.rules)).filter(day => day.date >= range.from && day.date <= range.to);
      const worked = days.filter(day => shiftsOf(subject).some(row => row.date === day.date));
      const only = days.length === 1 ? (worked.length ? (mine ? 'You work ' : subject + ' works ') : (mine ? 'You are off ' : subject + ' is off ')) + 'the one holiday ' + range.label + ', ' + days[0].name + '.' : '';
      return answer(only || (days.length ? (mine ? 'You work ' : subject + ' works ') + (worked.length || 'none') + ' of the ' + days.length + ' holidays ' + range.label + (worked.length ? ': ' + list(worked.map(day => day.name)) + '.' : '.') : 'No holiday falls ' + range.label + '.'),
        days.map(day => { const rows = shiftsOf(subject).filter(row => row.date === day.date); return { text: day.name + ', ' + pretty(day.date) + ': ' + (rows.length ? rows.map(row => shiftWord(row.shift) + (row.role ? ' (' + (ROLES[row.role] || row.role) + ')' : '')).join(', ') : 'off'), sub: '', go: 'date|' + day.date }; }),
        scheduleSource + '. The holidays are the ones ticked under Fairness. A night shift is counted on the day it starts.', { empty: false, lines: ['The schedule on record runs from ' + pretty(rosterFrom) + ' to ' + pretty(rosterTo) + '.'], understood: 'which holidays ' + (mine ? 'you work' : subject + ' works') + ', ' + range.label });
    }
    if (weekends) {
      const range = when && !when.bare && when.from !== when.to ? when : leftAsk && rosterTo >= today ? { from: today, to: rosterTo, label: 'left on this schedule' } : { from: today, to: addDays(today, 55), label: 'in the next eight weeks' };
      const rows = shiftsOf(subject).filter(row => row.date >= range.from && row.date <= range.to && isWeekendTurn(row));
      // A weekend runs Friday night to Sunday night, so Friday's date names it.
      const turns = new Set(rows.map(row => addDays(row.date, -((weekday(row.date) + 2) % 7))));
      return answer((range.to < today ? have : mine ? 'You have ' : subject + ' has ') + (rows.length || 'no') + ' weekend shift' + (rows.length === 1 ? '' : 's') + (rows.length > 1 ? ' on ' + turns.size + ' weekend' + (turns.size === 1 ? '' : 's') : '') + ' ' + range.label + (rows.length ? ':' : '.'), rows.map(shiftItem),
        scheduleSource + '. A weekend shift is Friday night through Sunday night.', { empty: false, lines: partly(range), next: mine ? ['How many weekends have I worked?'] : [], understood: (mine ? 'your' : subject + '’s') + ' weekend shifts, ' + range.label });
    }
    if (when && !when.bare) {
      const rows = shiftsOf(subject).filter(inRange);
      if (when.from === when.to) return answer(rows.length ? whose + ' ' + be + ' on ' + when.label + ':' : whose + ' ' + be + ' not on the schedule ' + when.label + '.', rows.map(shiftItem), scheduleSource, { empty: false });
      // "My first shift in December", "my last shift before Christmas"
      const end = / (first|last) (shift|day|night|one) /.exec(q)?.[1], edge = end && rows.length ? (end === 'first' ? rows[0] : rows.at(-1)) : null;
      if (edge) return answer((mine ? 'Your ' : subject + '’s ') + end + ' ' + kindOf + 'shift ' + when.label + (past ? ' was ' : ' is ') + pretty(edge.date) + ', ' + shiftWord(edge.shift) + '.', [shiftItem(edge)], scheduleSource,
        { empty: false, lines: [rows.length + ' shift' + (rows.length === 1 ? '' : 's') + ' ' + when.label + '.', ...partly(when)], understood: (mine ? 'your ' : subject + '’s ') + end + ' shift ' + when.label });
      return answer(have + (rows.length || 'no') + ' ' + kindOf + 'shift' + (rows.length === 1 ? '' : 's') + ' ' + when.label + (rows.length ? ':' : '.'), rows.map(shiftItem), scheduleSource, { empty: false, lines: partly(when) });
    }
    const every = shiftsOf(subject).filter(upcoming), coming = every.filter(row => !when?.shift || row.shift === when.shift).slice(0, 4);
    // A question about day shifts put to someone who works nights still gets their schedule, with the reason.
    if (!coming.length && every.length) return answer((mine ? 'You have' : subject + ' has') + ' no ' + kindOf + 'shifts from today on.', every.slice(0, 4).map(shiftItem), scheduleSource, { empty: false, lines: ['The next shifts on the schedule:'] });
    return answer(coming.length ? (same(subject, actor) ? 'Your' : subject + '’s') + ' next shift is ' + pretty(coming[0].date) + ', ' + shiftWord(coming[0].shift) + (coming[0].role ? ' (' + (ROLES[coming[0].role] || coming[0].role) + ')' : '') + '.' : whose + ' ' + be + ' not on the schedule from today on.',
      coming.map(shiftItem), scheduleSource, { empty: false, next: !coming.length ? [] : same(subject, actor) ? ['Who am I working with on my next shift?', ...(world.trade ? ['Who can I trade my next shift with?'] : [])] : ['How do I reach ' + subject + '?'] });
  }

  // Search taught answers, document passages and board posts.
  return documentAnswer();

  // The passage the record keeper chose for this question, while the document it came from is unchanged.
  function chosenPassage(fix) {
    const [, id, offset] = fix.go.split('|'), doc = documents.find(entry => entry.id === id);
    if (!doc || !fix.sourceHash || fix.sourceHash !== world.versions?.[id]) return null;
    return passagesOf([doc]).find(passage => passage.offset === Number(offset)) || null;
  }
  function documentAnswer(chosen = null, fix = null) {
    kind = 'look';
    const taught = matchTaught(q, taughtAnswers, { tidy: tidyText }), wanted = keywords(q);
    const found = searchDocuments(q, documents, 3, world.learned, world.versions).filter(passage => !chosen || passage.doc.id !== chosen.doc.id || passage.offset !== chosen.offset);
    if (chosen) { found.unshift({ ...chosen, hits: wanted.filter(term => chosen.counts.has(term)), also: [], chosen: true }); found.length = Math.min(found.length, 3); }
    if (!found.length && taught) return taughtAnswer(taught);
    const mentions = wanted.length ? posts.filter(post => post.body && overlap(wanted, keywords(post.body)) >= (wanted.length > 2 ? 0.6 : 1)).slice(-3).reverse() : [];
    if (found.length || mentions.length) {
      return answer(found.length ? 'From the documents the department has added' : 'Nothing in the documents. On the board:', [
        ...found.map(passage => ({ text: snippet(passage.text, [...passage.hits, ...passage.also]), sub: [passage.doc.title, passage.heading, passage.doc.kind, passage.doc.effective ? 'effective ' + passage.doc.effective : 'no effective date given',
          passage.chosen ? 'chosen for this question by ' + fix.by + ', as record keeper' : ''].filter(Boolean).join(' · '), go: 'doc|' + passage.doc.id + '|' + passage.offset })),
        ...mentions.map(post => ({ ...postItem(post), sub: 'A post on the board by ' + post.author + ', not policy' }))
      ], found.length ? 'Quoted from the document as added. Check its date, and ask the person responsible if it does not settle the question.' : 'The board. Posts are from coworkers and are not policy.',
        chosen ? { corrected: { id: fix.id, kind: 'passage', by: fix.by, at: fix.at } } : {});
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

export const SUGGESTIONS = ['When do I work next?', 'Who am I working with on my next shift?', 'Who is on tonight?', 'What did I miss on the board?', 'What is coming up?', 'How many weekends have I worked?', 'Who can I trade my next shift with?'];
