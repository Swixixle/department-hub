// Who carried what. Every number here comes from the roster or from something two people agreed to in the app.
// Nothing rates a person. Call-offs, declined requests and opinions are deliberately left out.

const weekday = date => new Date(date + 'T12:00:00Z').getUTCDay();
const key = name => name.trim().replace(/\s+/g, ' ').toLowerCase();
const nth = (year, month, day, count) => {            // count-th given weekday of a month, or the last one for count -1
  const dates = [];
  for (let d = 1; d <= 31; d++) { const date = new Date(Date.UTC(year, month, d)); if (date.getUTCMonth() === month && date.getUTCDay() === day) dates.push(date.toISOString().slice(0, 10)); }
  return count < 0 ? dates.at(-1) : dates[count - 1];
};
const fixed = (year, month, day) => year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
const period = assignments => {
  const dates = assignments.map(row => row.date).sort();
  return date => Boolean(dates.length && date >= dates[0] && date <= dates.at(-1));
};

// A starter list. The department decides which days count: rules.off names the ones that do not, and rules.extra adds
// days of its own as { name, date }.
export const HOLIDAY_NAMES = ["New Year's Day", 'Memorial Day', 'Independence Day', 'Labor Day', 'Thanksgiving', 'Christmas Eve', 'Christmas Day', "New Year's Eve"];
export function holidays(year, rules = {}) {
  const off = new Set(rules.off || []);
  const added = (rules.extra || []).filter(item => item?.name && String(item.date || '').startsWith(year + '-')).map(item => ({ name: item.name, date: item.date }));
  return [...standardHolidays(year).filter(item => !off.has(item.name)), ...added].sort((a, b) => a.date.localeCompare(b.date));
}
function standardHolidays(year) {
  return [
    ["New Year's Day", fixed(year, 1, 1)], ['Memorial Day', nth(year, 4, 1, -1)], ['Independence Day', fixed(year, 7, 4)], ['Labor Day', nth(year, 8, 1, 1)],
    ['Thanksgiving', nth(year, 10, 4, 4)], ['Christmas Eve', fixed(year, 12, 24)], ['Christmas Day', fixed(year, 12, 25)], ["New Year's Eve", fixed(year, 12, 31)]
  ].map(([name, date]) => ({ name, date }));
}

// A day shift is a weekend turn on Saturday and Sunday. A night shift is one when it starts Friday, Saturday or Sunday.
export const isWeekendTurn = row => row.shift === 'N' ? [5, 6, 0].includes(weekday(row.date)) : [6, 0].includes(weekday(row.date));

// One table for one pool (day shift or night shift).
// directory: { name: { status, arrangement } }. Students are left out.
// Two arrangements take a person, and the weekend shifts they work, out of the weekend rotation, so that nobody else
// is measured against them: 'weekend-only' is a position, and 'weekend-volunteer' is someone on a regular position who
// has offered to take extra weekends. The volunteer's turns beyond a regular share are shown as credit.
export function ledger(assignments, shift, directory = {}, rules = {}) {
  const rows = assignments.filter(row => row.shift === shift && directory[key(row.person)]?.status !== 'Student');
  const named = new Map();
  for (const row of rows) {
    const id = key(row.person);
    if (!named.has(id)) named.set(id, { person: row.person, status: directory[id]?.status || null, weekendOnly: directory[id]?.arrangement === 'weekend-only',
      weekendVolunteer: directory[id]?.arrangement === 'weekend-volunteer', shifts: 0, weekend: 0, charge: 0, icu: 0, extra: 0, holidays: [] });
    const entry = named.get(id);
    entry.shifts++;
    if (isWeekendTurn(row)) entry.weekend++;
    if (row.role === 'charge') entry.charge++;
    if (row.role === 'icu') entry.icu++;
    if (row.role === 'extra') entry.extra++;
    const holiday = holidays(Number(row.date.slice(0, 4)), rules).find(item => item.date === row.date);
    if (holiday) entry.holidays.push(holiday.name);
  }
  const people = [...named.values()];
  // Fair share of a kind of turn: the pool's turns, split by how many shifts each person in the pool works.
  const share = (pool, field) => {
    const turns = pool.reduce((sum, entry) => sum + entry[field], 0), shifts = pool.reduce((sum, entry) => sum + entry.shifts, 0);
    for (const entry of pool) entry[field + 'Fair'] = shifts ? turns * entry.shifts / shifts : 0;
  };
  // What a regular share would have been for a volunteer, had they stayed in the rotation.
  share(people.filter(entry => !entry.weekendOnly), 'weekend');
  for (const entry of people) entry.weekendExtra = entry.weekendVolunteer ? Math.max(0, entry.weekend - entry.weekendFair) : 0;
  const rotation = people.filter(entry => !entry.weekendOnly && !entry.weekendVolunteer);
  const regularShare = new Map(people.map(entry => [entry, entry.weekendFair]));
  share(rotation, 'weekend');
  for (const entry of people) if (entry.weekendVolunteer) entry.weekendFair = regularShare.get(entry);
  share(people.filter(entry => entry.charge > 0), 'charge');
  share(people.filter(entry => entry.icu > 0), 'icu');
  const most = Math.max(0, ...people.map(entry => entry.shifts));
  for (const entry of people) {
    // Regulars set the picture. Someone who works a handful of shifts is listed but does not stretch the spread.
    entry.regular = !entry.weekendOnly && !entry.weekendVolunteer &&
      (entry.status ? ['Staff', 'Contract'].includes(entry.status) && entry.shifts >= most * 0.4 : entry.shifts >= most * 0.6);
    entry.weekendGap = entry.weekendOnly || entry.weekendVolunteer ? null : entry.weekend - entry.weekendFair;
    entry.chargeGap = entry.charge ? entry.charge - entry.chargeFair : null;
    entry.icuGap = entry.icu ? entry.icu - entry.icuFair : null;
  }
  people.sort((a, b) => (b.weekendGap ?? -99) - (a.weekendGap ?? -99) || a.person.localeCompare(b.person));
  const gaps = people.filter(entry => entry.regular).map(entry => entry.weekendGap);
  const dates = rows.map(row => row.date).sort();
  return {
    shift, people, from: dates[0] || null, to: dates.at(-1) || null,
    spread: gaps.length ? Math.max(...gaps) - Math.min(...gaps) : 0,
    withinOne: gaps.filter(gap => Math.abs(gap) < 1).length, regulars: gaps.length,
    volunteers: people.filter(entry => entry.weekendVolunteer).map(entry => ({ person: entry.person, extra: entry.weekendExtra })),
    // Whoever is furthest below their share is first in line for the next weekend turn.
    next: people.filter(entry => entry.regular).sort((a, b) => a.weekendGap - b.weekendGap).slice(0, 3).map(entry => entry.person)
  };
}

// How many people a shift usually has, and the dates that have more or fewer. "Usual" is the most common headcount in
// this roster, so nothing has to be configured. Students are not counted. A partial shift counts as a person.
export function staffing(assignments, shift, directory = {}) {
  const byDate = new Map();
  for (const row of assignments) {
    if (row.shift !== shift || directory[key(row.person)]?.status === 'Student') continue;
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    if (!byDate.get(row.date).some(name => key(name) === key(row.person))) byDate.get(row.date).push(row.person);
  }
  const tally = new Map();
  for (const names of byDate.values()) tally.set(names.length, (tally.get(names.length) || 0) + 1);
  const usual = [...tally].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
  const dates = [...byDate].map(([date, people]) => ({ date, shift, people, extra: people.length - usual })).sort((a, b) => a.date.localeCompare(b.date));
  return { shift, usual, over: dates.filter(item => item.extra > 0), short: dates.filter(item => item.extra < 0) };
}

// Low-census releases (VA). Whoever has lost the fewest hours goes first. Voluntary and directed hours count together,
// so that offering to go home never puts someone first in line for a forced cut. Between people with the same hours,
// the one whose last release was longest ago goes first, again whether they offered or were sent. Anyone still level
// is marked as tied: the app has no basis to pick.
export function releaseOrder(working, releases = []) {
  const mine = name => releases.filter(item => key(item.person) === key(name));
  const order = [...working].map(person => ({
    person, hours: mine(person).reduce((sum, item) => sum + Number(item.hours || 0), 0),
    last: mine(person).map(item => item.date).sort().at(-1) || ''
  })).sort((a, b) => a.hours - b.hours || a.last.localeCompare(b.last) || a.person.localeCompare(b.person));
  for (const item of order) item.first = item.hours === order[0].hours && item.last === order[0].last;
  return order;
}

// Low census for one pool: the shifts that have more people than usual, how often each person is on one, and what each
// person has given up so far. On a shift with four people where three are usual, each of the four carries a quarter of
// that cut as their share (the carpool rule), so being scheduled on more of these shifts shows up as a larger share.
export function census(assignments, shift, directory = {}, releases = [], today = '') {
  const { usual, over, short } = staffing(assignments, shift, directory);
  const inPeriod = period(assignments);
  const named = new Map();
  const entry = person => {
    if (!named.has(key(person))) named.set(key(person), { person, onOver: 0, share: 0, turns: 0, hours: 0, offered: 0 });
    return named.get(key(person));
  };
  for (const item of over) for (const person of item.people) { entry(person).onOver++; entry(person).share += item.extra / item.people.length; }
  const pool = new Set(assignments.filter(row => row.shift === shift && directory[key(row.person)]?.status !== 'Student').map(row => key(row.person)));
  for (const item of releases) {
    if (item.shift !== shift || !pool.has(key(item.person)) || !inPeriod(item.date)) continue;
    const row = entry(item.person);
    row.turns++; row.hours += Number(item.hours || 0);
    if (item.voluntary) row.offered++;
  }
  const recorded = item => releases.some(release => release.date === item.date && release.shift === shift);
  for (const item of over) { item.recorded = recorded(item); item.order = releaseOrder(item.people, releases); }
  const people = [...named.values()].sort((a, b) => b.hours - a.hours || b.onOver - a.onOver || a.person.localeCompare(b.person));
  return {
    shift, usual, over, short, people,
    upcoming: over.filter(item => !item.recorded && (!today || item.date >= today)),
    unrecorded: over.filter(item => !item.recorded && today && item.date < today)
  };
}

// One person's sheet: what they carried, and the times they helped someone else out.
export function statSheet(name, { assignments, requests = [], releases = [], directory = {}, rules = {} }) {
  const mine = assignments.filter(row => key(row.person) === key(name));
  const shift = mine.filter(row => row.shift === 'N').length > mine.length / 2 ? 'N' : 'D';
  const table = ledger(assignments, shift, directory, rules);
  const row = table.people.find(entry => key(entry.person) === key(name)) || null;
  const inPeriod = period(assignments);
  const agreed = requests.filter(request => request.status?.startsWith('Both agreed') && inPeriod(request.from?.date));
  const own = releases.filter(item => key(item.person) === key(name) && inPeriod(item.date));
  return {
    person: name, shift, row,
    tradesAccepted: agreed.filter(request => request.kind === 'trade' && key(request.recipient) === key(name)).length,
    shiftsCovered: agreed.filter(request => request.kind === 'coverage' && key(request.recipient) === key(name)).length,
    weekendExtra: row?.weekendExtra || 0,
    wentHomeForSomeone: own.filter(item => item.voluntary && item.inPlaceOf && key(item.inPlaceOf) !== key(name)).length,
    releasedHours: own.reduce((sum, item) => sum + Number(item.hours || 0), 0)
  };
}

// The holiday tracker: who worked which holiday, on either shift. One row per person and one column per holiday that
// falls inside the dates on record. A night shift belongs to the day it starts.
export function holidayTracker(assignments, directory = {}, rules = {}) {
  const dates = assignments.map(row => row.date).sort();
  if (!dates.length) return { days: [], people: [] };
  const years = [];
  for (let year = Number(dates[0].slice(0, 4)); year <= Number(dates.at(-1).slice(0, 4)); year++) years.push(year);
  const days = years.flatMap(year => holidays(year, rules)).filter(day => day.date >= dates[0] && day.date <= dates.at(-1));
  const wanted = new Set(days.map(day => day.date)), named = new Map();
  for (const row of assignments) {
    if (!wanted.has(row.date) || directory[key(row.person)]?.status === 'Student') continue;
    if (!named.has(key(row.person))) named.set(key(row.person), { person: row.person, worked: {}, count: 0 });
    const entry = named.get(key(row.person));
    if ((entry.worked[row.date] || '').includes(row.shift)) continue;
    entry.worked[row.date] = [...(entry.worked[row.date] || ''), row.shift].sort().join('');
    entry.count++;
  }
  return { days, people: [...named.values()].sort((a, b) => b.count - a.count || a.person.localeCompare(b.person)) };
}

// Only a supplied date AND shift replaces an earlier cell. A date range cannot establish that a missing date or the
// other shift was supplied; preserve those rows, including when the import is just one corrected day or night page.
export function carryForward(history = [], outgoing = [], incoming = []) {
  const covered = new Set(incoming.map(row => row.date + '|' + row.shift));
  const kept = new Map();
  for (const row of [...history, ...outgoing]) {
    if (covered.has(row.date + '|' + row.shift)) continue;
    kept.set([row.date, row.shift, key(row.person)].join('|'), { date: row.date, shift: row.shift, person: row.person, ...(row.role ? { role: row.role } : {}), ...(row.hours ? { hours: row.hours } : {}) });
  }
  return [...kept.values()].sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift) || a.person.localeCompare(b.person));
}

// Historical shifts still need their staff settings (especially Student and weekend-only). Keep those profiles even
// when a person is absent from the new roster. Callers supply an empty previous state when switching out of the demo.
export function publicationRecord({ history = [], assignments = [], directory = {} } = {}, incoming = []) {
  const profiles = { ...directory };
  for (const row of incoming) if (!profiles[key(row.person)]) profiles[key(row.person)] = { person: row.person, status: null, skills: [] };
  return { history: carryForward(history, assignments, incoming), directory: profiles };
}

// Who is carrying more than their share and who less, among the regulars, by at least `margin` weekend turns.
export function standing(table, margin = 1) {
  const regulars = table.people.filter(entry => entry.regular);
  return {
    over: regulars.filter(entry => entry.weekendGap >= margin).sort((a, b) => b.weekendGap - a.weekendGap),
    under: regulars.filter(entry => entry.weekendGap <= -margin).sort((a, b) => a.weekendGap - b.weekendGap),
    level: regulars.filter(entry => Math.abs(entry.weekendGap) < margin).length
  };
}
