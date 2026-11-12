// Executing a plan over the records.
//
// This file does the counting and nothing else: it is handed a plan (src/plan.js) and the records the asker is
// allowed to see, and it returns numbers. It never reads the question, so a plan is the only thing that can decide
// what gets counted, and the answer cannot quietly be about something other than the plan says.
//
// The arithmetic authority stays where it already was. A weekend turn is isWeekendTurn from src/fairness.js — the
// app's existing definition, where a night shift counts from Friday — and a fair share is the ledger's, because
// that is the only thing that knows how a share is worked out. Nothing here invents a second answer to either.
import { holidays, isWeekendTurn, ledger } from './fairness.js';
import { normalizeName, shiftInterval } from './model.js';
import { METRICS } from './plan.js';

const key = normalizeName;
const DAY = 864e5;
const weekday = date => new Date(date + 'T12:00:00Z').getUTCDay();

// Which weekend a weekend turn belongs to, named by that weekend's Saturday. A Friday night belongs to the weekend
// it runs into, which is why two Friday nights a week apart are two weekends and a Friday night and the Saturday
// night after it are one.
export function weekendOf(row) {
  const day = weekday(row.date);
  const offset = day === 5 ? 1 : day === 0 ? -1 : 0;
  return new Date(Date.parse(row.date + 'T12:00:00Z') + offset * DAY).toISOString().slice(0, 10);
}

const hoursOf = row => { const [from, to] = shiftInterval(row); return Number.isFinite(from) && Number.isFinite(to) ? (to - from) / 3.6e6 : 12; };

// The rows a plan looks at: the period it names, the shift it names, the role it names, and students left out the
// same way the fairness ledger leaves them out.
export function rowsFor(plan, { assignments = [], directory = {} }) {
  return assignments.filter(row => {
    if (directory[key(row.person)]?.status === 'Student') return false;
    if (plan.shift && row.shift !== plan.shift) return false;
    if (plan.role && row.role !== plan.role) return false;
    if (plan.when && (row.date < plan.when.from || row.date > plan.when.to)) return false;
    return true;
  });
}

// Every person's figure for one metric. Returns [{ person, value, shifts }], highest first, ties kept together.
export function measure(plan, world) {
  const rows = rowsFor(plan, world);
  const holidayDates = new Set();
  if (plan.metric === 'holidays') {
    const years = new Set(rows.map(row => Number(row.date.slice(0, 4))));
    for (const year of years) for (const day of holidays(year, world.rules || {})) holidayDates.add(day.date);
  }
  const named = new Map();
  const touch = person => { const id = key(person); if (!named.has(id)) named.set(id, { person, value: 0, shifts: 0, weekends: new Set() }); return named.get(id); };
  for (const row of rows) {
    const entry = touch(row.person);
    entry.shifts++;
    switch (plan.metric) {
      case 'weekend-shifts': if (isWeekendTurn(row)) entry.value++; break;
      case 'distinct-weekends': if (isWeekendTurn(row)) entry.weekends.add(weekendOf(row)); break;
      case 'shifts': entry.value++; break;
      case 'hours': entry.value += hoursOf(row); break;
      case 'charge-turns': if (row.role === 'charge') entry.value++; break;
      case 'icu-turns': if (row.role === 'icu') entry.value++; break;
      case 'holidays': if (holidayDates.has(row.date)) entry.value++; break;
      default: break;
    }
  }
  for (const entry of named.values()) if (plan.metric === 'distinct-weekends') entry.value = entry.weekends.size;

  // A fair share is the ledger's arithmetic, not a second version of it. It is worked out per shift pool, which is
  // why a plan asking for it without naming a shift is sent back for one specific clarification instead.
  if (plan.metric === 'weekend-fair-gap') {
    const table = ledger(rows, plan.shift, world.directory || {}, world.rules || {});
    named.clear();
    for (const entry of table.people) {
      if (entry.weekendGap === null) continue;             // weekend-only and volunteer positions are outside the rotation
      named.set(key(entry.person), { person: entry.person, value: entry.weekendGap, shifts: entry.shifts, weekends: new Set(), fair: entry.weekendFair, weekend: entry.weekend });
    }
  }

  const everyone = [...named.values()].map(entry => ({ person: entry.person, value: entry.value, shifts: entry.shifts,
    ...(entry.fair === undefined ? {} : { fair: entry.fair, weekend: entry.weekend }) }));
  everyone.sort((a, b) => b.value - a.value || a.person.localeCompare(b.person));
  return everyone;
}

// The period the figures cover, named explicitly so an answer never leaves it to be guessed.
export function periodOf(plan, world) {
  if (plan.when) return { from: plan.when.from, to: plan.when.to, label: plan.when.label, source: 'the dates in the question' };
  const dates = rowsFor({ ...plan, when: null }, world).map(row => row.date).sort();
  if (!dates.length) return { from: null, to: null, label: 'no dates on record', source: 'the schedule on record' };
  return { from: dates[0], to: dates.at(-1), label: null, source: 'the schedule on record' };
}

// Runs a plan. Returns what the answer needs and nothing it has to work out for itself.
//
//   status   'ok' | 'empty' | 'clarify'
//   rows     every person's figure, highest first
//   winners  the people the question asked for: the top (or bottom) group, ties together
//   missing  named people the question compared who have no figure in this period
export function runPlan(plan, world) {
  const period = periodOf(plan, world);
  if (plan.metric === 'weekend-fair-gap' && !plan.shift)
    return { status: 'clarify', ask: 'shift', period, rows: [], winners: [], missing: [],
      question: 'A fair share is worked out within one shift, so day and night are counted separately. Which did you mean?',
      choices: ['Day shift', 'Night shift'] };

  const rows = measure(plan, world);
  const excluded = new Set(plan.exclude.map(key));
  const included = new Set(plan.people.map(key));
  const eligible = rows.filter(row => !excluded.has(key(row.person)) && (!included.size || included.has(key(row.person))));

  if (plan.op === 'count') {
    // Every person's figure, in order, with nobody singled out as a winner.
    return { status: eligible.length ? 'ok' : 'empty', period, rows: eligible, winners: eligible, missing: [] };
  }

  // "who has more weekends than Blair": everybody past one person's figure. The mark is that person's own number,
  // so it is reported too — a list of names without the number it had to beat is not an answer.
  if (plan.op === 'threshold') {
    const mark = rows.find(row => key(row.person) === key(plan.than));
    if (!mark) return { status: 'empty', period, rows: eligible, winners: [], missing: [plan.than], mark: null };
    const past = eligible.filter(row => key(row.person) !== key(plan.than)
      && (plan.direction === 'lowest' ? row.value < mark.value : row.value > mark.value));
    return { status: 'ok', period, rows: eligible, winners: past, missing: [], mark };
  }

  if (plan.op === 'compare') {
    const wanted = plan.people.filter(name => !excluded.has(key(name)));
    const found = wanted.map(name => eligible.find(row => key(row.person) === key(name)) || null);
    return { status: found.some(Boolean) ? 'ok' : 'empty', period, rows: eligible,
      winners: found.filter(Boolean).sort((a, b) => plan.direction === 'lowest' ? a.value - b.value : b.value - a.value),
      missing: wanted.filter((name, index) => !found[index]) };
  }

  if (!eligible.length) return { status: 'empty', period, rows: [], winners: [], missing: [] };
  const ordered = plan.direction === 'lowest' ? [...eligible].reverse() : eligible;
  const limit = plan.limit || 1;
  // Ties are part of the answer. With a limit, everyone level with the last place inside it is included.
  const cut = ordered[Math.min(limit, ordered.length) - 1].value;
  const winners = plan.direction === 'lowest' ? ordered.filter(row => row.value <= cut) : ordered.filter(row => row.value >= cut);
  return { status: 'ok', period, rows: ordered, winners, missing: [] };
}

// A figure in words. A fair-share difference is signed and reads as above or under; a count does not.
export function tellValue(plan, value) {
  const metric = METRICS[plan.metric] || { unit: '', plural: '' };
  if (plan.metric === 'weekend-fair-gap') {
    const size = Math.abs(value);
    if (size < 0.05) return 'level with a fair share';
    return size.toFixed(1) + ' ' + (size === 1 ? metric.unit : metric.plural) + (value > 0 ? ' above' : ' under') + ' a fair share';
  }
  const rounded = plan.metric === 'hours' ? Math.round(value * 10) / 10 : value;
  return rounded + ' ' + (rounded === 1 ? metric.unit : metric.plural);
}
