// Reading what people actually type: shorthand, misspellings, word endings and the department's own words for things.
// These are the old, well-worn tools of search, not a language model. Nothing here guesses at meaning. A word is only
// ever changed into a word the app already knows, and the change is reported.

const SHORTHAND = { im: 'i am', whos: 'who is', whats: 'what is', wheres: 'where is', hows: 'how is', whens: 'when is', tmrw: 'tomorrow', tmr: 'tomorrow', tomm: 'tomorrow', tonite: 'tonight', '2nite': 'tonight', tn: 'tonight', nite: 'night', nites: 'nights', workin: 'working',
  '2day': 'today', wknd: 'weekend', wkend: 'weekend', sched: 'schedule', mtg: 'meeting', mtgs: 'meetings', wen: 'when', wat: 'what', u: 'you', r: 'are', ur: 'your', b4: 'before', nxt: 'next', w: 'with', wit: 'with',
  wk: 'week', wks: 'weeks', wkends: 'weekends', wknds: 'weekends', wrk: 'work', wrks: 'works', wrkn: 'working', wrking: 'working', '2morrow': 'tomorrow', '2moro': 'tomorrow', '2mrw': 'tomorrow', tmw: 'tomorrow', tom: 'tomorrow',
  any1: 'anyone', some1: 'someone', every1: 'everyone', ne1: 'anyone', hw: 'how', hrs: 'hours', hr: 'hour', ppl: 'people', dept: 'department', mgr: 'manager', vaca: 'vacation', vacay: 'vacation', req: 'request', reqs: 'requests',
  avail: 'available', info: 'information', doc: 'document', docs: 'documents', bc: 'because', cuz: 'because', abt: 'about', tho: 'though', thru: 'through', da: 'the', dis: 'this', dat: 'that', yr: 'year', mo: 'month',
  cant:'cannot', dont:'do not', doesnt:'does not', isnt:'is not', arent:'are not', shouldnt:'should not', mustnt:'must not',
  pls: '', plz: '', thx: '', hey: '', hi: '', sat: 'saturday', sun: 'sunday', mon: 'monday', tues: 'tuesday', tue: 'tuesday', wed: 'wednesday', thur: 'thursday', thurs: 'thursday', fri: 'friday', xmas: 'christmas' };

// Different words for one thing. Any word in a group finds the others.
export const SYNONYMS = [
  ['leave', 'time off', 'vacation', 'pto', 'day off', 'days off'], ['low census', 'sent home', 'volume adjusted', 'va'], ['trade', 'swap', 'switch'],
  ['coverage', 'cover', 'pick up', 'pickup'], ['meeting', 'huddle', 'inservice', 'in-service'], ['due', 'deadline', 'turn in'], ['ventilator', 'vent'], ['policy', 'rule'], ['protocol', 'guideline'],
  ['phone', 'number', 'cell'], ['request', 'ask for', 'apply'], ['overtime', 'ot', 'extra hours'], ['orientation', 'onboarding', 'new hire'], ['competency', 'competencies', 'check off', 'checkoff']
];

// Words Ask itself listens for. A misspelling is corrected toward these, toward names on the schedule and toward the
// department's own documents, and toward nothing else.
export const CORE_WORDS = ('when where who what how work works working worked shift shifts schedule scheduled next today tonight tomorrow yesterday weekend week night nights days morning ' +
  'sunday monday tuesday wednesday thursday friday saturday january february march april june july august september october november december christmas thanksgiving holiday holidays ' +
  'with number phone call text reach contact fair fairness share carrying weekends many short understaffed overstaffed extra census four people miss missed news announcement announcements latest unread board ' +
  'due deadline meeting meetings event events upcoming coming calendar policy procedure protocol document request leave before after about ' +
  // "show" was being read as "how" and "each" as "reach", which turned a follow-up into a new question. The other
  // comparison words the planner reads — most, fewest, except, excluding and the rest — are already left alone, and
  // adding them here would make each of them a new target for the corrector to pull other words towards: that is
  // how "cover" became "over" on the first attempt at this.
  'show each busiest quietest shortest proportion skip').split(' ');

// Damerau-Levenshtein distance: insert, delete, substitute, or swap two neighbouring letters. Stops counting past `max`.
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before = null, last = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(last[j] + 1, row[j - 1] + 1, last[j - 1] + cost);
      if (before && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], before[j - 2] + 1);
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    before = last;
    last = row;
  }
  return last[b.length];
}

// The nearest known word, if one is close enough: one edit for a short word, two for a long one. The first letter is
// rarely the one people get wrong, so a candidate that keeps it wins a tie.
export function nearest(word, known) {
  const allowed = word.length >= 8 ? 2 : 1;
  let found = null, distance = allowed + 1;
  for (const candidate of known) {
    if (Math.abs(candidate.length - word.length) > allowed) continue;
    const d = editDistance(word, candidate, allowed);
    if (d < distance || (d === distance && found && candidate[0] === word[0] && found[0] !== word[0])) { found = candidate; distance = d; }
  }
  return distance <= allowed ? found : null;
}

// A light stemmer, so "requesting", "requests" and "requested" meet at "request".
export function stem(word) {
  let w = word.toLowerCase().replace(/'s$/, '');
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.length > 3 && w.at(-1) === w.at(-2) && !'aeiouls'.includes(w.at(-1))) w = w.slice(0, -1);
  return w;
}

const STOP = new Set('the and for are was were with that this from have has had not but you your our out who what when where how does did can could should would there their they them then than into about any all its his her she him also may must shall will been being more most some such only per get got need want know tell please thanks'.split(' '));
export const QUALIFIERS = ['not', 'no', 'never', 'without', 'cannot', 'must', 'may', 'can', 'should'];
for (const word of QUALIFIERS) STOP.delete(word);
export const qualifiers = text => QUALIFIERS.filter(word => new RegExp('\\b' + word + '\\b').test(text.toLowerCase())).join('|');
export const keywords = text => [...new Set((text.toLowerCase().match(/[a-z0-9]{2,}/g) || []).filter(word => word.length > 2 && !STOP.has(word)).map(stem))];

// Shorthand is spelled out, then a word the app does not know is moved to the nearest one it does. `names` are people on
// the schedule, `familiar` is every word in the department's documents and posts (those are never "corrected").
// Returns { text, changes: [[typed, read]] }.
export function tidyQuestion(question, names = [], familiar = new Set()) {
  const nameWords = new Map(names.flatMap(name => name.toLowerCase().split(' ').filter(part => part.length > 2).map(part => [part, part])));
  const known = new Set([...CORE_WORDS, ...nameWords.keys()]);
  const changes = [];
  const ambiguous = [];
  const words = question.toLowerCase().replace(/[’]/g, "'").replace(/w\//g, 'with ').replace(/[^a-z0-9'\/\s-]/g, ' ').split(/\s+/).filter(Boolean).map(word => {
    const bare = word.replace(/'/g, '');
    if (bare in SHORTHAND && !nameWords.has(bare)) return SHORTHAND[bare];
    const plain = bare.replace(/s$/, '');
    if (bare.length < 4 || /\d/.test(bare) || known.has(bare) || known.has(plain) || familiar.has(stem(bare)) || STOP.has(bare)) return word;
    const fixed = nearest(bare, known);
    if (fixed && nameWords.has(fixed)) {
      const distance = editDistance(bare, fixed);
      const choices = [...nameWords.keys()].filter(name => editDistance(bare, name, distance) === distance);
      if (choices.length > 1) { ambiguous.push({ typed:word, choices }); return word; }
    }
    if (fixed && fixed !== bare) { changes.push([word, fixed]); return fixed; }
    return word;
  });
  // One sound-alike worth catching: "when is it do" means due.
  let text = words.filter(Boolean).join(' ');
  if (/\b(is|are|was|were|its|it|that) (?:[a-z'-]+ ){0,4}do$/.test(text)) { text = text.replace(/do$/, 'due'); changes.push(['do', 'due']); }
  const typed = question.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9'\/\s-]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
  return { text, changes, ambiguous, changed: text !== typed };
}

// Every other way of saying what the question says, from the synonym groups and from anything the department has
// taught. Returns extra stems and phrases to look for.
export function expand(text, groups = SYNONYMS) {
  const lower = ' ' + text.toLowerCase() + ' ', extra = new Set();
  for (const group of groups) {
    if (!group.some(term => lower.includes(' ' + term + ' ') || lower.includes(' ' + term + 's '))) continue;
    for (const term of group) extra.add(term);
  }
  return [...extra];
}

// Ordinary ways of saying things Ask already understands, rewritten into words it routes on. This is deliberately
// narrow: each phrase is recognised in the context that makes it a work question, never substituted everywhere.
// Returns { text, changes: [[typed, read]] }, so the answer can show what it did.
const PHRASES = [
  // "do i have to come in tomorrow" is a schedule question; "when does this come into effect" is not.
  [/\b(come|comes|coming|came)\s+in(?:to)?\b(?!\s+(?:effect|force|play|view|question|contact|focus|being|use|place))(?:\s+to\s+work)?/g, 'work'],
  // "are we thin tonight" is about staffing; "thin liquids" is a clinical phrase and must stay one.
  [/\b(?:are|is|was|were|look|looks|looking|feel|feels|feeling|be|been|running|pretty|bit|too|very|so|real|really)\s+((?:\w+\s+){0,2}?)thin\b(?!\s+(?:liquid|liquids|film|films|layer|layers|client|clients|section|sections))/g, (whole, middle) => whole.replace(/thin$/, 'short')]
];
export function readWorkPhrases(text) {
  let out = String(text || ''), changes = [];
  for (const [shape, into] of PHRASES) {
    out = out.replace(shape, (...args) => {
      const whole = args[0], next = typeof into === 'function' ? into(...args) : into;
      if (next !== whole) changes.push([whole.trim(), next.trim()]);
      return next;
    });
  }
  return { text: out.replace(/\s+/g, ' ').trim(), changes };
}

// A message that is only courtesy, with no question in it.
const THANKS = /^\s*(?:ok(?:ay)?|alright|cool|great|perfect|awesome|nice|sweet|yes|yep|yeah)?[\s,.!]*(?:thanks?(?:\s+you)?|thank\s+you|thx|ty|tysm|appreciate\s+it|much\s+appreciated|got\s+it|gotcha)[\s,.!]*(?:a\s+lot|so\s+much|again|man|dude|buddy|friend)?[\s,.!]*$/i;
export const isThanks = text => THANKS.test(String(text || ''));
