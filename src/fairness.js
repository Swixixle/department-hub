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

// A starter list. The department decides which days count.
export function holidays(year) {
  return [
    ["New Year's Day", fixed(year, 1, 1)], ['Memorial Day', nth(year, 4, 1, -1)], ['Independence Day', fixed(year, 7, 4)], ['Labor Day', nth(year, 8, 1, 1)],
    ['Thanksgiving', nth(year, 10, 4, 4)], ['Christmas Eve', fixed(year, 12, 24)], ['Christmas Day', fixed(year, 12, 25)], ["New Year's Eve", fixed(year, 12, 31)]
  ].map(([name, date]) => ({ name, date }));
}

// A day shift is a weekend turn on Saturday and Sunday. A night shift is one when it starts Friday, Saturday or Sunday.
export const isWeekendTurn = row => row.shift === 'N' ? [5, 6, 0].includes(weekday(row.date)) : [6, 0].includes(weekday(row.date));

// One table for one pool (day shift or night shift).
// directory: { name: { status, arrangement } }. Students are left out. People on a weekend-only arrangement are left out
// of the weekend count, along with the weekend shifts they cover, so nobody else is measured against them.
export function ledger(assignments, shift, directory = {}) {
  const rows = assignments.filter(row => row.shift === shift && directory[key(row.person)]?.status !== 'Student');
  const named = new Map();
  for (const row of rows) {
    const id = key(row.person);
    if (!named.has(id)) named.set(id, { person: row.person, status: directory[id]?.status || null, weekendOnly: directory[id]?.arrangement === 'weekend-only',
      shifts: 0, weekend: 0, charge: 0, icu: 0, extra: 0, holidays: [] });
    const entry = named.get(id);
    entry.shifts++;
    if (isWeekendTurn(row)) entry.weekend++;
    if (row.role === 'charge') entry.charge++;
    if (row.role === 'icu') entry.icu++;
    if (row.role === 'extra') entry.extra++;
    const holiday = holidays(Number(row.date.slice(0, 4))).find(item => item.date === row.date);
    if (holiday) entry.holidays.push(holiday.name);
  }
  const people = [...named.values()];
  // Fair share of a kind of turn: the pool's turns, split by how many shifts each person in the pool works.
  const share = (pool, field) => {
    const turns = pool.reduce((sum, entry) => sum + entry[field], 0), shifts = pool.reduce((sum, entry) => sum + entry.shifts, 0);
    for (const entry of pool) entry[field + 'Fair'] = shifts ? turns * entry.shifts / shifts : 0;
  };
  share(people.filter(entry => !entry.weekendOnly), 'weekend');
  share(people.filter(entry => entry.charge > 0), 'charge');
  share(people.filter(entry => entry.icu > 0), 'icu');
  const most = Math.max(0, ...people.map(entry => entry.shifts));
  for (const entry of people) {
    // Regulars set the picture. Someone who works a handful of shifts is listed but does not stretch the spread.
    entry.regular = !entry.weekendOnly && (entry.status ? ['Staff', 'Contract'].includes(entry.status) && entry.shifts >= most * 0.4 : entry.shifts >= most * 0.6);
    entry.weekendGap = entry.weekendOnly ? null : entry.weekend - entry.weekendFair;
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
    // Whoever is furthest below their share is first in line for the next weekend turn.
    next: people.filter(entry => entry.regular).sort((a, b) => a.weekendGap - b.weekendGap).slice(0, 3).map(entry => entry.person)
  };
}

// Low-census releases (VA). Voluntary and directed hours count together toward who is next, so that offering to go
// home never puts someone first in line for a forced cut.
export function releaseOrder(working, releases = []) {
  const hours = name => releases.filter(item => key(item.person) === key(name)).reduce((sum, item) => sum + Number(item.hours || 0), 0);
  const last = name => releases.filter(item => key(item.person) === key(name) && !item.voluntary).map(item => item.date).sort().at(-1) || '';
  return [...working].sort((a, b) => hours(a) - hours(b) || last(a).localeCompare(last(b)) || a.localeCompare(b)).map(person => ({ person, hours: hours(person) }));
}

// One person's sheet: what they carried, and the times they helped someone else out.
export function statSheet(name, { assignments, requests = [], releases = [], directory = {} }) {
  const mine = assignments.filter(row => key(row.person) === key(name));
  const shift = mine.filter(row => row.shift === 'N').length > mine.length / 2 ? 'N' : 'D';
  const table = ledger(assignments, shift, directory);
  const row = table.people.find(entry => key(entry.person) === key(name)) || null;
  const agreed = requests.filter(request => request.status?.startsWith('Both agreed'));
  const own = releases.filter(item => key(item.person) === key(name));
  return {
    person: name, shift, row,
    tradesAccepted: agreed.filter(request => request.kind === 'trade' && key(request.recipient) === key(name)).length,
    shiftsCovered: agreed.filter(request => request.kind === 'coverage' && key(request.recipient) === key(name)).length,
    wentHomeForSomeone: own.filter(item => item.voluntary && item.inPlaceOf && key(item.inPlaceOf) !== key(name)).length,
    releasedHours: own.reduce((sum, item) => sum + Number(item.hours || 0), 0)
  };
}
