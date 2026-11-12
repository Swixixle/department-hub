// Reading a comparison question into a plan.
//
// The old failure this replaces: "Who has the most weekends on day shift, other than Avery?" was dispatched on
// keywords, the keywords that matched were the ones for a roster lookup, and the answer was who is on today. The
// ranking, the shift filter and the exclusion were simply dropped. Adding a pattern for that sentence would have
// fixed that sentence and nothing else.
//
// So a question is read into a plan made of parts that combine — an operation, a metric, filters, exclusions — and
// the plan is executed separately (src/measure.js). The stages are kept apart on purpose:
//
//   normalise  ->  recognise parts  ->  PLAN  ->  repair edits the plan's fields  ->  permission  ->  execute  ->  words
//
// Two rules hold the whole thing together. A constraint that is recognised is never silently dropped: if it cannot
// be executed it goes in `unsupported` and the answer is a clarification, not an easier question answered
// confidently. And the plan is what the "Understood as" line is written from, so that line says what actually ran.
//
// There is no model here and no outside service. This file reads words; it does not know anything about shifts.
import { normalizeName } from './model.js';
import { CORE_WORDS } from './words.js';

const same = (a, b) => normalizeName(a) === normalizeName(b);

// Each metric is a different question about the same records, and saying which one was counted is part of the answer.
export const METRICS = {
  'weekend-shifts': { label: 'weekend shifts', unit: 'weekend shift', plural: 'weekend shifts' },
  'distinct-weekends': { label: 'distinct weekends worked', unit: 'weekend', plural: 'weekends' },
  'weekend-fair-gap': { label: 'weekend turns above or below a fair share', unit: 'turn', plural: 'turns', signed: true },
  shifts: { label: 'shifts', unit: 'shift', plural: 'shifts' },
  hours: { label: 'scheduled hours', unit: 'hour', plural: 'hours' },
  'charge-turns': { label: 'charge turns', unit: 'charge turn', plural: 'charge turns' },
  'icu-turns': { label: 'ICU turns', unit: 'ICU turn', plural: 'ICU turns' },
  holidays: { label: 'holidays worked', unit: 'holiday', plural: 'holidays' }
};

const COUNTS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// "other than Avery", "except Avery and Morgan", "not counting Avery". The words run up to the next clause, so a
// comma or a question mark ends the exclusion rather than swallowing the rest of the sentence.
// Every way a person says "leave this one out". A missing one here is the worst kind of miss: the question is
// answered confidently about a group the asker did not ask about. Found by an evaluation set, not by guessing.
// Who the question is asking ABOUT. An interrogative on the near side means the askers wants a list — a threshold.
// A person or the asker on the near side means two named sides, which is a comparison.
const OPEN_SUBJECT = /^\s*(?:so|ok|okay|um|and|well)?[\s,]*(?:who|whos|who's|whose|which|anyone|anybody|does anyone|does anybody|is there anyone|is there anybody|is anyone|is anybody|any ?one|any ?body)\b/i;
const EXCLUDE_LEAD = /\b(?:other than|apart from|aside from|except(?: for)?|excluding|not counting|leaving out|leave out|left out|taking out|take out|without|besides|but not|minus|skip|skipping|ignore|ignoring|forget|barring|save for|everyone but|everybody but|anyone but|all but)\b/g;
const INCLUDE_LEAD = /\b(?:include|including|count|counting|add|put|with)\b/g;

// A superlative is what makes a question a ranking. Bare "more" and "fewer" are deliberately not here: "shifts with
// more or fewer people than usual" and "any week over the limit" are other questions with good answers already, and
// a planner that grabbed them would be the same mistake in the other direction.
const HIGH = /\b(?:most|highest|greatest|largest|biggest|busiest|top|furthest\s+(?:above|over)|over)\b/;
const LOW = /\b(?:least|fewest|lowest|less|fewer|lower|smallest|quietest|bottom|shortest|furthest\s+(?:under|below)|under|below|short of|behind)\b/;
// A superlative, or an instruction to put people in order. A grammar library would hand this over as one tag class
// (see docs/ASK-PLANNER.md on the Compromise spike); until then the list is explicit, which is a cost in words a
// person might use that it has never met.
const RANK_WORDS = new RegExp('\\b(?:most|least|fewest|highest|lowest|greatest|largest|smallest|busiest|quietest|furthest|' +
  'top\\s+(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten)|bottom\\s+(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten)|' +
  'shortest|(?:rank|order|sort|list)(?:ed|ing|s)?\\s+(?:everyone|everybody|all|the|each|people|staff|them|us|by)|in order of)\\b');
// Comparing named people: "who has more weekend day shifts, Blair or Casey?"
const COMPARE_WORDS = /\b(?:more|less|fewer|higher|lower|than|compare[sd]?|comparing|versus|vs|against|or)\b/;
// A per-person count: "how many different weekends has each person worked on nights".
const EACH_PERSON = /\b(?:each|every)\s+(?:person|one|member|therapist|rt)\b|\beveryone\b|\beverybody\b|\bper\s+person\b|\beach\s+of\s+(?:them|us)\b/;
const COUNT_WORDS = /\b(?:how many|how much|number of|count|total)\b/;
const FIRST_PERSON = /\b(?:i|me|my|mine|myself)\b/;
// "who has more weekends than Blair", "does anyone beat Blair on weekend days", "who works fewer than me".
// A threshold, not a ranking and not a two-person comparison: it asks for everybody past one person's figure.
// The earlier version of this file dropped the "than Blair" and the question fell through to an ordinary lookup,
// which answered Blair's own shifts instead — the exact failure the build brief names for "more than".
const THRESHOLD = /\b(?:more|less|fewer|higher|lower|greater|beats?|beat|above|over|under|below|behind|ahead of)\b[^?]*?\bthan\b|\b(?:beats?|beat|outworks?)\b|\b(?:above|over|under|below|ahead of|behind)\b(?=\s+[a-z][a-z'-]{2,})/;

// A follow-up that continues the last question rather than starting a new one. Without this, "who is on tonight?"
// after a ranking would be read as a date change to the ranking.
const CONTINUES = /^\s*(?:no|nope|nah|yes|yeah|ok|okay|and|also|plus|now|just|only|same|show|what about|how about|how bout|include|including|add|except|excluding|other than|top|bottom|sort|rank|instead|actually|sorry|wait)\b/i;
const INTERROGATIVE = /\b(?:who|what|when|where|why|how|which)\b/i;
// Text that actually names a period, as against text parseWhen will date to today for want of anything better.
const NAMES_A_DATE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tonight|tomorrow|yesterday|week|weeks|month|months|weekend|weekends|christmas|thanksgiving|holiday|holidays|\d{1,2}(?:st|nd|rd|th)?|\d{4}-\d{2}-\d{2})\b/;

// Modifiers that can be read but not executed. Recognising one is the point: it produces a clarification rather
// than an answer to a question nobody asked.
const UNSUPPORTED = [
  [/\b(?:per month|a month|per week|a week|per year|monthly|weekly|yearly|each month|each week|per shift|a shift|per hour|an hour)\b/, 'a rate per month, week, year or shift'],
  [/\b(?:proportion|fraction|ratio|share of (?:their|his|her|the)?\s*shifts)\b/, 'a proportion of somebody\u2019s shifts'],
  [/\b(?:on average|averages?|averaging|mean|median|typical(?:ly)?)\b/, 'an average'],
  [/\b(?:weighted|normalis(?:ed|e)|normaliz(?:ed|e)|adjusted for|relative to the|percent|percentage|%)\b/, 'a weighted or percentage figure'],
  [/\bas\s+(?:many|few|much)\b[^.?!]*\bas\b|\bthe same (?:number|amount) as\b|\bexactly\s+(?:as many|the same)\b/, 'a count equal to somebody else\u2019s'],
  [/\b(?:last year|next year|this year|year to date|ytd|since january|all time|ever)\b/, 'a period outside the schedule on record'],
  [/\b(?:trend(?:s|ing)?|over time|month by month|week by week|compared to last|going up|going down)\b/, 'a change over time'],
  [/\b(?:predict|forecast|likely|expect(?:ed)?|should get|deserve[sd]?|fair(?:est)? to)\b/, 'a judgement about what should happen']
];

const positionsOf = (text, names) => names.map(name => {
  const pattern = new RegExp('(^|[^a-z])' + name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "(?:'s)?(?![a-z])");
  const found = pattern.exec(text.toLowerCase());
  return { name, at: found ? found.index + found[1].length : -1 };
}).filter(entry => entry.at >= 0).sort((a, b) => a.at - b.at);

// Words that can follow an exclusion without being a name: "except on weekends", "excluding the night shift".
const NOT_A_NAME = new Set([...CORE_WORDS, 'the', 'a', 'an', 'and', 'or', 'on', 'in', 'for', 'from', 'of', 'this', 'that',
  'their', 'theirs', 'his', 'hers', 'its', 'our', 'ours', 'your', 'yours', 'mine', 'own', 'usual', 'average',
  'these', 'those', 'time', 'times', 'one', 'two', 'three', 'four', 'five', 'me', 'my', 'myself', 'him', 'her', 'them',
  'anyone', 'anybody', 'everyone', 'everybody', 'nobody', 'staff', 'crew', 'side', 'nights', 'days', 'shifts', 'shift']);

// The names that follow an exclusion word, up to the end of that clause, in the order the question says them —
// plus any word in that clause that was clearly meant as a name and matches nobody, so it is not silently dropped.
function namesAfter(text, leads, names) {
  const low = ' ' + text.toLowerCase() + ' ', taken = [], unresolved = [];
  leads.lastIndex = 0;
  for (let hit = leads.exec(low); hit; hit = leads.exec(low)) {
    // "and" joins names inside the clause ("except Avery and Morgan"), so it is not a clause break.
    const clause = low.slice(hit.index + hit[0].length).split(/[.;?!]|\b(?:but|and then|who|which|that)\b/)[0];
    const found = [];
    for (const name of names) {
      const pattern = new RegExp('(^|[^a-z])' + name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "(?:'s)?(?![a-z])");
      const at = pattern.exec(clause);
      if (at && !taken.some(held => same(held, name))) found.push({ name, at: at.index });
    }
    for (const entry of found.sort((a, b) => a.at - b.at)) taken.push(entry.name);
    let rest = clause;
    for (const entry of found) rest = rest.replace(new RegExp(entry.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' ');
    for (const word of rest.split(/[^a-z'-]+/).filter(Boolean))
      if (word.length > 2 && !NOT_A_NAME.has(word) && !NOT_A_NAME.has(word.replace(/s$/, '')) && !unresolved.includes(word)) unresolved.push(word);
  }
  leads.lastIndex = 0;
  return { taken, unresolved };
}

// The reference is the operand immediately after the comparison, never a name from a later exclusion.
// This version executes one strict person-to-person boundary. Retain unsupported compound/negated
// constraints explicitly so they cannot turn into a confident answer to a simpler question.
function thresholdReference(q, lead, names, actor) {
  const tail = q.slice(lead.index + lead[0].length).trimStart();
  const escaped = name => name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = [...names].sort((a,b)=>b.length-a.length).find(name => new RegExp('^' + escaped(name) + "(?:'s)?(?![a-z])").test(tail));
  const pronoun = /^(?:me|myself|mine|i)\b/.exec(tail);
  const person = named || (pronoun ? actor : null) || null;
  const consumed = named ? new RegExp('^' + escaped(named) + "(?:'s)?").exec(tail)[0].length : pronoun?.[0].length || 0;
  const unknown = !person ? /^[a-z][a-z'-]{2,}/.exec(tail)?.[0] : null;
  const unresolved = unknown && !NOT_A_NAME.has(unknown) ? [unknown] : [];
  const remaining = tail.slice(consumed);
  const exclusion = remaining.search(new RegExp(EXCLUDE_LEAD.source));
  const constraintTail = exclusion < 0 ? remaining : remaining.slice(0,exclusion);
  const unsupported = [];
  if (person && (positionsOf(constraintTail,names).length || THRESHOLD.test(constraintTail)))
    unsupported.push('more than one comparison reference or boundary');
  if (/\b(?:no|not)\s*$/.test(q.slice(0,lead.index)))
    unsupported.push('a negated threshold such as “no more than”');
  return {person,unresolved,unsupported};
}

function readMetric(q) {
  // "above their fair share", "over their weekend share", "under his share of weekends". Up to two words sit
  // between the possessive and "share", which is what a noun-phrase head would give for nothing.
  if (/\b(?:above|over|under|below|beyond|past|short of|shortest of|behind on)\s+(?:their|his|her|its|the|a|my|your)?\s*(?:\w+\s+){0,2}shares?\b/.test(q) ||
      /\bfair(?:ness)?\s+(?:share|gap|difference)\b/.test(q) || /\bshares?\s+of\s+(?:the\s+)?weekends?\b/.test(q)) return 'weekend-fair-gap';
  if (/\b(?:distinct|different|separate|individual|unique)\s+weekends?\b/.test(q)) return 'distinct-weekends';
  if (/\bweekends?\b/.test(q)) return 'weekend-shifts';
  if (/\bholidays?\b/.test(q)) return 'holidays';
  if (/\bcharge\b/.test(q)) return 'charge-turns';
  if (/\b(?:icu|i\.c\.u\.?)\b/.test(q)) return 'icu-turns';
  if (/\bhours?\b/.test(q)) return 'hours';
  if (/\b(?:shifts?|days? on|nights? on|turns?)\b/.test(q)) return 'shifts';
  // "who is busiest on nights" names no metric but means the number of shifts.
  if (/\b(?:busiest|quietest|most\s+booked|hardest\s+worked)\b/.test(q)) return 'shifts';
  return null;
}

function readShift(q) {
  // "on day shift", "day staff", "the days", "weekend days", "nights". A night shift question and a question about
  // Monday are not the same thing, so a weekday name never selects a shift.
  if (/\b(?:both|either|any)\s+shifts?\b/.test(q) ||
      /\bdays?(?:\s+shifts?)?\s+(?:and|or)\s+nights?(?:\s+shifts?)?\b/.test(q) ||
      /\bnights?(?:\s+shifts?)?\s+(?:and|or)\s+days?(?:\s+shifts?)?\b/.test(q)) return null;
  if (/\b(?:night|nights|nocs|noc|overnight)\b/.test(q) && !/\bnight(?:ingale)\b/.test(q)) return 'N';
  if (/\bday\s*(?:shift|shifts|staff|crew|side)\b/.test(q) || /\b(?:on|the)\s+days?\b(?!\s+(?:off|before|after|of))/.test(q)
    || /\bdayshift\b/.test(q) || /\bweekend\s+days?\b/.test(q)) return 'D';
  return null;
}

const readRole = q => /\bcharge\b/.test(q) ? 'charge' : /\b(?:icu|i\.c\.u\.?)\b/.test(q) ? 'icu' : null;

function readLimit(q) {
  const named = /\b(?:top|bottom|first|last|highest|lowest)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/.exec(q)
    || /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:most|least|highest|lowest|fewest|busiest)\b/.exec(q);
  if (!named) return null;
  const value = COUNTS[named[1]] ?? Number(named[1]);
  return Number.isInteger(value) && value > 0 && value <= 50 ? value : null;
}

// Reads a plan, or returns null when the question is not a comparison and the ordinary lookups should have it.
//
// `names` is every person on the schedule, `people` the ones this question mentions and `when` the period it names;
// ask.js has already worked those out, so this file does no date parsing and no name matching of its own beyond
// finding where a known name sits in the sentence.
export function readPlan({ text, names = [], people = [], when = null, actor = '', last = null }) {
  const q = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ').trim() + ' ';
  const excluded = namesAfter(q, EXCLUDE_LEAD, names), exclude = excluded.taken;
  const mentioned = positionsOf(q, names).map(entry => entry.name);
  const subjects = mentioned.filter(name => !exclude.some(out => same(out, name)));
  const metric = readMetric(q);
  // "who is over their weekend share" asks the same thing a ranking asks: it wants the people at one end of the
  // fair-share figure. The Understood line says it was read as a ranking, so the reading is visible.
  const ranks = RANK_WORDS.test(q) || (metric === 'weekend-fair-gap' && /^ (?:who|which|whos|who's)\b/.test(q));
  // "do i work more weekends than Blair" compares the asker with a named person, so the asker is a subject too.
  const withActor = actor && FIRST_PERSON.test(q) && subjects.length ? [actor, ...subjects] : subjects;
  // "than <person>" or "beats <person>": whoever is named is the mark to pass, not a person being ranked.
  // A threshold asks for everybody past one person. It needs an open subject ("who", "does anyone") — with a person
  // or the asker named on the near side the question compares two sides instead, and "more than their fair share"
  // is a metric rather than a mark, so it is not a threshold at all.
  const lead = THRESHOLD.exec(q);
  const nearSide = lead ? q.slice(0, lead.index) : q;
  const looksLikeThreshold = Boolean(lead) && OPEN_SUBJECT.test(q.trim()) && metric !== 'weekend-fair-gap'
    && !FIRST_PERSON.test(nearSide) && !positionsOf(nearSide, names).length;
  const reference = looksLikeThreshold ? thresholdReference(q,lead,names,actor) : {person:null,unresolved:[],unsupported:[]};
  const threshold = reference.person && metric ? reference.person : null;
  // A name after "than" that matches nobody. Without this the whole threshold is dropped and the question falls
  // through to an ordinary lookup, which is how "more than" went missing in the first place.
  const unknownMark = looksLikeThreshold && metric ? reference.unresolved : [];
  const compares = !threshold && withActor.length > 1 && COMPARE_WORDS.test(q);
  const perPerson = EACH_PERSON.test(q) && COUNT_WORDS.test(q);
  const unsupported = [...UNSUPPORTED.filter(([pattern]) => pattern.test(q)).map(([, what]) => what), ...reference.unsupported];

  // Only a ranking, a comparison between named people, or an explicit per-person count belongs here. A question
  // about the asker's own figures — "how many weekends have I worked" — already has a better answer elsewhere, and
  // claiming it would be the same kind of error as dropping a constraint: answering with the wrong machinery.
  if (!metric) return null;
  // A modifier that cannot be executed is claimed even without a ranking word, so that "what percentage of
  // weekends does Blair work" is refused rather than answered with Blair's weekend count, which is a different
  // question wearing the same clothes.
  if (!ranks && !compares && !perPerson && !threshold && !unknownMark.length && !unsupported.length) return null;

  const op = threshold || unknownMark.length ? 'threshold' : perPerson && !ranks && !compares ? 'count' : compares && !ranks ? 'compare' : 'rank';
  const direction = op === 'count' ? 'highest' : LOW.test(q) && !HIGH.test(q) ? 'lowest' : LOW.test(q) && HIGH.test(q) ? (q.search(LOW) < q.search(HIGH) ? 'lowest' : 'highest') : 'highest';

  // "weekend day shifts" names a metric, not a period. parseWhen reads the bare word as "this weekend", which would
  // quietly narrow a question about the whole schedule to two days, so a weekend metric keeps a period only when
  // the question points at one: "this weekend", "in December", a date.
  const weekendMetric = metric === 'weekend-shifts' || metric === 'distinct-weekends' || metric === 'weekend-fair-gap';
  // Strip metric words and rank limits before looking for a date. A weekday is a real date constraint;
  // "weekend shifts" alone is not, and the 3 in "top 3" must not select this weekend.
  const periodText = q.replace(/\b(?:top|bottom|first|last|highest|lowest)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ')
    .replace(/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:most|least|highest|lowest|fewest|busiest)\b/g, ' ')
    .replace(/\bweekends?\b/g, ' ');
  const pointsAtAPeriod = !weekendMetric || /\b(?:this|next|last|that|the)\s+weekend\b/.test(q) || NAMES_A_DATE.test(periodText);

  return {
    op, metric, direction,
    limit: readLimit(q),
    shift: readShift(q),
    role: metric === 'charge-turns' || metric === 'icu-turns' ? null : readRole(q),
    people: op === 'compare' ? [...new Set(withActor)] : op === 'threshold' ? [] : subjects,
    // The person whose figure everybody else is measured against.
    than: threshold,
    exclude,
    when: when && !when.bare && pointsAtAPeriod ? when : null,
    ties: true,
    unsupported,
    // A name the question asked to leave out that matches nobody on the schedule. Answering as if the exclusion
    // were not there would be answering a different question.
    unresolved: [...excluded.unresolved, ...unknownMark],
    // What the question asked for and the plan could not represent is carried, never dropped.
    asked: String(text || '').trim()
  };
}

// A follow-up that changes one field of the plan already answered, rather than starting again.
// "Same thing for nights", "only in December", "no, include Avery this time", "what about the top three".
export function repairPlan(plan, { text, said: typed = null, names = [], when = null, actor = '' }) {
  if (!plan) return null;
  // The continuation cue is judged on what the person typed, not on the normalised text: normalisation can turn a
  // cue into an interrogative ("show" into "how") and so turn a follow-up into a new question.
  const said = String(typed ?? text ?? '').trim();
  const q = ' ' + said.toLowerCase().replace(/\s+/g, ' ').trim() + ' ';
  // A continuation is short, and either opens with a cue or asks nothing of its own. Anything else is a new
  // question and is left to the ordinary routing.
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (words.length > 9) return null;
  if (!CONTINUES.test(said) && INTERROGATIVE.test(said)) return null;
  const next = { ...plan, people: [...plan.people], exclude: [...plan.exclude], unsupported: [...plan.unsupported], unresolved: [...plan.unresolved], asked: String(text || '').trim() };
  let touched = false;

  const added = namesAfter(q, INCLUDE_LEAD, names).taken;
  if (added.length) { next.exclude = next.exclude.filter(name => !added.some(back => same(back, name))); touched = true; }
  const removed = namesAfter(q, EXCLUDE_LEAD, names);
  if (removed.taken.length) { for (const name of removed.taken) if (!next.exclude.some(held => same(held, name))) next.exclude.push(name); touched = true; }
  next.unresolved = [...new Set([...next.unresolved,...removed.unresolved])];
  if (next.unresolved.length) touched = true;

  const thresholdLead = plan.op === 'threshold' ? THRESHOLD.exec(q) : null;
  if (thresholdLead) {
    const reference = thresholdReference(q,thresholdLead,names,actor);
    next.than = reference.person;
    next.unresolved = [...removed.unresolved,...reference.unresolved];
    next.unsupported = [...UNSUPPORTED.filter(([pattern]) => pattern.test(q)).map(([, what]) => what),...reference.unsupported];
    touched = true;
  }

  const shift = readShift(q);
  if (shift && shift !== plan.shift) { next.shift = shift; touched = true; }
  if (/\b(?:either|both|any)\s+shift\b|\bboth shifts\b|\bdays? and nights?\b/.test(q)) { next.shift = null; touched = true; }

  // A period is applied only when the follow-up names one. parseWhen falls back to today for text that names no
  // date at all, and "same thing for nights" is not a question about today.
  if (when && !when.bare && NAMES_A_DATE.test(q)) { next.when = when; touched = true; }
  if (/\b(?:whole|all|entire|any)\s+(?:schedule|period|time)\b|\bno date limit\b/.test(q)) { next.when = null; touched = true; }

  const limit = readLimit(q);
  if (limit) { next.limit = limit; touched = true; }

  if (LOW.test(q) && !HIGH.test(q) && plan.direction === 'highest') { next.direction = 'lowest'; touched = true; }
  else if (HIGH.test(q) && !LOW.test(q) && plan.direction === 'lowest') { next.direction = 'highest'; touched = true; }

  const metric = readMetric(q);
  if (metric && metric !== plan.metric) { next.metric = metric; touched = true; }

  next.unsupported = [...new Set([...next.unsupported,...UNSUPPORTED.filter(([pattern]) => pattern.test(q)).map(([, what]) => what)])];
  if (next.unsupported.length) touched = true;
  return touched ? next : null;
}

// The "Understood as" line, written from the plan, so it says what ran. Anything the plan could not represent is
// named here too rather than left out.
export function describePlan(plan, { periodLabel = '' } = {}) {
  if (!plan) return '';
  const metric = METRICS[plan.metric]?.label || plan.metric;
  const shift = plan.shift === 'D' ? ' on day shift' : plan.shift === 'N' ? ' on night shift' : '';
  const role = plan.role ? ' marked ' + (plan.role === 'icu' ? 'ICU' : plan.role) : '';
  const period = plan.when?.label ? ' ' + plan.when.label : periodLabel ? ' on ' + periodLabel : '';
  const without = plan.exclude.length ? ', excluding ' + joined(plan.exclude) : '';
  const among = plan.op !== 'compare' && plan.people.length ? ', among ' + joined(plan.people) : '';
  const head = plan.op === 'compare' ? joined(plan.people) + ' compared by ' + metric
    : plan.op === 'count' ? metric + ' for each person'
    : plan.op === 'threshold' ? 'Everybody with ' + (plan.direction === 'lowest' ? 'fewer ' : 'more ') + metric + ' than ' + (plan.than || 'somebody I could not identify')
    : (plan.direction === 'lowest' ? 'Lowest ' : 'Highest ') + metric;
  const top = plan.op === 'compare' || !plan.limit ? '' : ', the ' + (plan.direction === 'lowest' ? 'lowest ' : 'highest ') + plan.limit;
  return head + shift + role + period + top + among + without;
}

const joined = names => names.length < 3 ? names.join(' and ') : names.slice(0, -1).join(', ') + ' and ' + names.at(-1);
export { joined };
