// Trades between any number of people, worked out with plain arithmetic. There is no language model and no solver here.
//
// A move hands one assignment to one person. An exchange is a list of moves that happen together or not at all. The whole
// exchange is applied first and then every person in it is checked, because moves that each look fine can fail together
// and moves that each fail alone can work together.
//
// Nothing here knows who wants what, who is on leave, or what the patient load is. It works from the schedule as
// imported and the rules as entered, and every result says so.
import { AGREED_STATUS, EXCHANGE_AGREED, POLICY, minutesByWeek, normalizeName, shiftInterval } from './model.js';

const key = normalizeName;
const ROLE = { charge: 'charge', icu: 'ICU' };
const DAY = 864e5;
export const dayName = date => new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
export const shiftName = row => dayName(row.date) + (row.shift === 'N' ? ' night' : ' day');
const shortDay = date => new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const hours = minutes => String(Math.round(minutes / 6) / 10);
const list = names => names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names.at(-1);

export const applyMoves = (roster, moves) => {
  const to = new Map(moves.map(move => [move.key, move.to]));
  return roster.map(row => to.has(row.key) ? { ...row, person: to.get(row.key) } : row);
};

// What a person can be given. Recorded qualifications win. With none recorded, a person can be given the kinds of shift
// this schedule already lists them on, and nothing else.
function abilities(roster, directory = {}) {
  const seen = new Map();
  for (const row of roster) {
    const id = key(row.person);
    if (!seen.has(id)) seen.set(id, { shifts: new Set(), roles: new Set() });
    seen.get(id).shifts.add(row.shift);
    if (row.role) seen.get(id).roles.add(row.role);
  }
  return name => {
    const profile = directory[key(name)], found = seen.get(key(name)) || { shifts: new Set(), roles: new Set() };
    return { status: profile?.status || null, shifts: profile?.status && profile.skills?.length ? new Set(profile.skills) : found.shifts, roles: found.roles };
  };
}

// The checker for one roster. judge() looks at one person after they give some shifts and take others.
function checker({ roster, directory = {}, policy = POLICY, committed = [], today = '' }) {
  const able = abilities(roster, directory), taken = new Set(committed), startDay = policy.weekStartsOn || 0;
  const rest = (policy.minimumRestMinutes || 0) * 60000, limit = policy.overtimeLimitMinutes || Infinity;
  const mine = new Map(), spans = new Map(), weeks = new Map(), memo = new Map();
  for (const row of roster) { const id = key(row.person); if (!mine.has(id)) mine.set(id, []); mine.get(id).push(row); }
  const span = row => { if (!spans.has(row.key)) spans.set(row.key, shiftInterval(row)); return spans.get(row.key); };
  const week = row => { if (!weeks.has(row.key)) weeks.set(row.key, minutesByWeek(row, startDay)); return weeks.get(row.key); };
  const total = rows => { const sum = new Map(); for (const row of rows) for (const [name, minutes] of week(row)) sum.set(name, (sum.get(name) || 0) + minutes); return sum; };

  function judge(person, gives, takes) {
    const id = key(person) + '>' + gives.map(row => row.key).join(',') + '<' + takes.map(row => row.key).join(',');
    if (memo.has(id)) return memo.get(id);
    const problems = [], cautions = [], notes = [], info = able(person);
    const before = mine.get(key(person)) || [], kept = before.filter(row => !gives.some(given => given.key === row.key));
    if (info.status === 'Student' && !policy.allowStudents) problems.push('Students are not part of trades or coverage.');
    if (info.status === 'PRN' && !(gives.length ? policy.allowPrnTrade : policy.allowPrnCoverage)) problems.push('The rules entered leave PRN staff out of this kind of change.');
    for (const row of [...gives, ...takes]) {
      if (taken.has(row.key)) problems.push(shiftName(row) + ' is already part of an agreed request.');
      if (today && row.date < today) problems.push(shiftName(row) + ' has already passed.');
    }
    for (const take of takes) {
      if (gives.some(given => given.date === take.date && given.shift === take.shift)) { problems.push(person + ' would give up and take the same shift.'); continue; }
      if (!info.shifts.has(take.shift)) { problems.push(person + ' is not listed on any ' + (take.shift === 'N' ? 'night' : 'day') + ' shift, and no qualification for it is recorded.'); continue; }
      const [start, end] = span(take);
      for (const other of [...kept, ...takes.filter(row => row !== take)]) {
        const [from, to] = span(other);
        if (start < to && from < end) problems.push(person + ' would be on two shifts at once on ' + shortDay(take.date) + '.');
        else if (rest && Math.max(start - to, from - end) < rest) problems.push(person + ' would have under ' + hours(rest / 60000) + ' hours between ' + shiftName(other) + ' and ' + shiftName(take) + '.');
      }
      if (ROLE[take.role] && !info.roles.has(take.role)) cautions.push(ROLE[take.role][0].toUpperCase() + ROLE[take.role].slice(1) + ' cover needs checking: ' + person + ' is not listed as ' + ROLE[take.role] + ' on this schedule.');
    }
    const was = total(before), now = total([...kept, ...takes]), changed = [];
    for (const name of [...new Set([...was.keys(), ...now.keys()])].sort()) {
      const a = was.get(name) || 0, b = now.get(name) || 0;
      if (a === b) continue;
      changed.push({ week: name, before: a, after: b });
      if (b > limit && b > a) (policy.overLimit === 'warn' ? cautions : problems).push(person + ' would be at ' + hours(b) + ' hours in the week of ' + shortDay(name) + '. The limit entered is ' + hours(limit) + '.');
    }
    if (takes.length) {                                   // how many days in a row the new shifts make
      const days = new Set([...kept, ...takes].map(row => row.date)); let longest = 0;
      for (const take of takes) { let run = 1; for (let t = Date.parse(take.date) - DAY; days.has(new Date(t).toISOString().slice(0, 10)); t -= DAY) run++; for (let t = Date.parse(take.date) + DAY; days.has(new Date(t).toISOString().slice(0, 10)); t += DAY) run++; longest = Math.max(longest, run); }
      if (policy.maxInARow && longest > policy.maxInARow) cautions.push(person + ' would work ' + longest + ' days in a row. The limit entered is ' + policy.maxInARow + '.');
      else if (longest >= 4) notes.push(person + ' would work ' + longest + ' days in a row.');
    }
    const result = { person, gives, takes, problems, cautions, notes, weeks: changed };
    memo.set(id, result);
    return result;
  }
  return { judge, week, rows: new Map(roster.map(row => [row.key, row])) };
}

function verdict(parts) {
  const problems = [...new Set(parts.flatMap(part => part.problems))], cautions = [...new Set(parts.flatMap(part => part.cautions))];
  return { status: problems.length ? 'blocked' : cautions.length ? 'check' : 'ok', problems, cautions, notes: [...new Set(parts.flatMap(part => part.notes))], people: parts };
}

// Checks a whole exchange. moves: [{ key, to }]. Returns { status: 'ok' | 'check' | 'blocked', problems, cautions, notes, people }.
export function checkExchange({ moves, ...world }, shared = null) {
  const check = shared || checker(world), problems = [];
  const rows = moves.map(move => check.rows.get(move.key));
  if (rows.some(row => !row)) return { status: 'blocked', problems: ['A shift in this exchange is no longer on the schedule as it was.'], cautions: [], notes: [], people: [] };
  if (new Set(moves.map(move => move.key)).size !== moves.length) problems.push('The same shift is moved twice.');
  moves.forEach((move, index) => { if (key(move.to) === key(rows[index].person)) problems.push(rows[index].person + ' already has ' + shiftName(rows[index]) + '.'); });
  const names = new Map();
  moves.forEach((move, index) => { for (const name of [rows[index].person, move.to]) if (!names.has(key(name))) names.set(key(name), name); });
  const parts = [...names].map(([id, name]) => check.judge(name, rows.filter(row => key(row.person) === id), rows.filter((row, index) => key(moves[index].to) === id)));
  const result = verdict(parts);
  return problems.length ? { ...result, status: 'blocked', problems: [...problems, ...result.problems] } : result;
}

// One person's changed weeks as "36 → 48 in the week of Nov 8".
export const weekChanges = part => part.weeks.map(item => hours(item.before) + ' → ' + hours(item.after) + ' in the week of ' + shortDay(item.week)).join(', ');

// The same result in sentences. `viewer` is addressed as "you".
export function describe(result, viewer = '') {
  const you = name => key(name) === key(viewer), who = name => you(name) ? 'You' : name, whose = name => you(name) ? 'your' : name + '’s';
  const lines = [];
  for (const part of result.people) for (const take of part.takes) lines.push(who(part.person) + (you(part.person) ? ' take ' : ' takes ') + whose(take.person) + ' ' + shiftName(take) + '.');
  if (result.people.length > 2) for (const part of result.people) if (part.gives.length && !part.takes.length) lines.push(who(part.person) + (you(part.person) ? ' are' : ' is') + ' off ' + list(part.gives.map(shiftName)) + ' and ' + (you(part.person) ? 'pick' : 'picks') + ' up nothing.');
  const moved = result.people.filter(part => part.weeks.length);
  lines.push(moved.length ? 'Hours: ' + moved.map(part => who(part.person) + ' ' + weekChanges(part)).join('; ') + '.' : 'Nobody’s weekly hours change.');
  if (result.status !== 'blocked') lines.push('Rest and overlap checks pass.');
  return [...lines, ...result.notes, ...result.cautions, ...result.problems];
}

// Every way the person on `target` could come off it, under the rules entered. Most people asking for a trade want to
// keep their weekly hours, so the options that leave everyone's weeks as they were come first:
//   keep:      two people swap shifts in the same pay week
//   keepLoops: three people each hand a shift to the next, all in the same pay week
//   swaps:     two people swap, and hours move between weeks
//   pickups:   someone takes it and gives nothing back, so the person asking loses the hours
//   chains:    someone takes it only because a third person picks up one of theirs
//   loops:     every other three-person exchange (the slow search, done only when `loops` is asked for)
// Each kind is sorted so the simplest come first, and only `limit` of each are returned. counts says how many passed.
export function findOptions({ target, offers = [], limit = 5, loops = false, ...world }) {
  const check = checker(world), me = target.person, today = world.today || '';
  const others = world.roster.filter(row => key(row.person) !== key(me) && row.date >= today);
  const people = [...new Map(world.roster.filter(row => key(row.person) !== key(me)).map(row => [key(row.person), row.person])).values()];
  const offered = name => offers.some(offer => key(offer.person) === key(name) && offer.date === target.date && offer.shift === target.shift);
  const at = Date.parse(target.date), found = { keep: [], keepLoops: [], swaps: [], pickups: [], chains: [], loops: [] };
  const add = (kind, moves, parts) => {
    const result = verdict(parts);
    if (result.status === 'blocked') return;
    const said = offered(moves[0].to), neutral = parts.every(part => !part.weeks.length);
    const far = moves.slice(1).reduce((sum, move) => sum + Math.abs(Date.parse(check.rows.get(move.key).date) - at) / DAY, 0);
    found[neutral && kind === 'swaps' ? 'keep' : neutral && kind === 'loops' ? 'keepLoops' : kind].push({ kind, moves, said, neutral, ...result,
      rank: (said ? -1000 : 0) + result.cautions.length * 100 + parts.reduce((sum, part) => sum + part.weeks.length, 0) * 10 + far });
  };
  // Shifts that fall in the same pay week, hour for hour. Exchanging these leaves everyone's weekly hours alone.
  const weeks = row => JSON.stringify(check.week(row)), sameWeeks = others.filter(row => weeks(row) === weeks(target));
  const off = check.judge(me, [target], []);
  const direct = new Map(people.map(name => [key(name), check.judge(name, [], [target])]));
  for (const name of people) add('pickups', [{ key: target.key, to: name }], [off, direct.get(key(name))]);
  for (const theirs of others) {
    const b = theirs.person, takesMine = check.judge(b, [theirs], [target]);
    if (takesMine.problems.length) continue;
    const iTake = check.judge(me, [target], [theirs]);
    if (!iTake.problems.length) add('swaps', [{ key: target.key, to: b }, { key: theirs.key, to: me }], [iTake, takesMine]);
    // A chain is only worth showing when this person could not simply have picked the shift up.
    if (direct.get(key(b)).problems.length) for (const c of people) if (key(c) !== key(b)) add('chains', [{ key: target.key, to: b }, { key: theirs.key, to: c }], [off, takesMine, check.judge(c, [], [theirs])]);
    for (const third of loops ? others : sameWeeks.includes(theirs) ? sameWeeks : []) {
      if (key(third.person) === key(b)) continue;
      const cTakes = check.judge(third.person, [third], [theirs]);
      if (cTakes.problems.length) continue;
      const iTakeThird = check.judge(me, [target], [third]);
      if (!iTakeThird.problems.length) add('loops', [{ key: target.key, to: b }, { key: theirs.key, to: third.person }, { key: third.key, to: me }], [iTakeThird, takesMine, cTakes]);
    }
  }
  const counts = {};
  for (const kind of Object.keys(found)) { counts[kind] = found[kind].length; found[kind] = found[kind].sort((a, b) => a.rank - b.rank).slice(0, limit); }
  if (!loops) delete counts.loops;
  return { ...found, counts, blockedForMe: off.problems, sameWeekLeft: sameWeeks.length };
}

// Whose schedule an exchange changes.
export const parties = (moves, rows) => [...new Map(moves.flatMap(move => [rows.get(move.key)?.person, move.to]).filter(Boolean).map(name => [key(name), name])).values()];

// Agreed exchanges, written the way the fairness record counts help: taking a shift and giving none is cover, taking one
// and giving one is a trade. The person who asked is not credited for their own request.
export function exchangeCredits(exchanges = []) {
  return exchanges.filter(exchange => exchange.status === EXCHANGE_AGREED).flatMap(exchange => {
    const names = [...new Map(exchange.moves.flatMap(move => [move.from, move.to]).map(name => [key(name), name])).values()];
    return names.filter(name => key(name) !== key(exchange.by)).map(name => {
      const takes = exchange.moves.filter(move => key(move.to) === key(name)), gives = exchange.moves.filter(move => key(move.from) === key(name));
      return takes.length ? { kind: gives.length ? 'trade' : 'coverage', recipient: name, status: AGREED_STATUS, from: { date: takes[0].date } } : null;
    }).filter(Boolean);
  });
}
