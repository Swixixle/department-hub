export const SHIFTS = {
  D: { label: 'Day', start: '07:00', end: '19:00' },
  N: { label: 'Night', start: '19:00', end: '07:00' }
};

export const POLICY = {
  version: 'pilot-1',
  source: 'Illustrative department rules',
  zone: 'America/Indiana/Indianapolis',
  overtimeLimitMinutes: 40 * 60,
  minimumByShift: { D: 4, N: 3 },
  allowPrnTrade: false,
  allowPrnCoverage: true,
  allowOvertimeTrade: false,
  allowOvertimeCoverage: false
};

export const normalizeName = name => name.trim().replace(/\s+/g, ' ').toLowerCase();
export const assignmentKey = item => [item.date, item.shift, normalizeName(item.person)].join('|');
export const addDays = (date, days) => {
  const value = new Date(date + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
export const weekStart = date => addDays(date, -new Date(date + 'T12:00:00Z').getUTCDay());
const zoneFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: POLICY.zone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function zonedInstant(date, time) {
  const target = Date.parse(date + 'T' + time + ':00Z');
  let estimate = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const {year, month, day, hour, minute, second} = Object.fromEntries(
      zoneFormat.formatToParts(estimate).filter(part => part.type !== 'literal').map(part => [part.type, part.value])
    );
    const represented = Date.parse(year + '-' + month + '-' + day + 'T' + hour + ':' + minute + ':' + second + 'Z');
    const delta = target - represented;
    if (!delta) return estimate;
    estimate += delta;
  }
  throw new Error('Ambiguous or invalid shift time');
}

export function shiftInterval(item) {
  const shift = SHIFTS[item.shift];
  if (!shift) throw new Error('Unsupported shift label');
  const endDate = shift.end > shift.start ? item.date : addDays(item.date, 1);
  return [zonedInstant(item.date, shift.start), zonedInstant(endDate, shift.end)];
}

export function minutesByWeek(item) {
  const [start, end] = shiftInterval(item);
  const week = weekStart(item.date);
  const next = addDays(week, 7);
  const boundary = zonedInstant(next, '00:00');
  if (end <= boundary) return [[week, (end - start) / 60000]];
  return [[week, (boundary - start) / 60000], [next, (end - boundary) / 60000]];
}

export function mergeAssignments(items) {
  const unique = new Map();
  for (const item of items) {
    const key = assignmentKey(item);
    if (unique.has(key)) {
      const current = unique.get(key);
      current.sources.push(...item.sources.filter(source => !current.sources.some(
        existing => existing.page === source.page && existing.box.join(',') === source.box.join(',')
      )));
    } else unique.set(key, { ...item, key, sources: [...item.sources] });
  }
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift) || a.person.localeCompare(b.person));
}

export function verifyRoster(rows, policy = POLICY) {
  const issues = [];
  const byPerson = Map.groupBy(rows, row => normalizeName(row.person));
  for (const group of byPerson.values()) {
    const byTime = group.map(row => ({ row, time: shiftInterval(row) })).sort((a, b) => a.time[0] - b.time[0]);
    for (let i = 1; i < byTime.length; i++) {
      if (byTime[i].time[0] < byTime[i - 1].time[1]) {
        const { row } = byTime[i];
        issues.push({ date: row.date, message: row.person + ' has overlapping shifts.' });
      }
    }
  }
  for (const [date, group] of Map.groupBy(rows, row => row.date)) {
    for (const shift of Object.keys(SHIFTS)) {
      const count = group.filter(row => row.shift === shift).length;
      if (count !== policy.minimumByShift[shift]) {
        issues.push({ date, message: SHIFTS[shift].label + ' shift has ' + count + ' assignments. Sample target is ' + policy.minimumByShift[shift] + '.' });
      }
    }
  }
  return issues;
}

const same = (left, right) => normalizeName(left) === normalizeName(right);

export function evaluateChange({ roster, from, to, recipient, kind, directory, hoursVerified = false, policy = POLICY }) {
  const second = kind === 'trade' ? to?.person : recipient;
  if (!second || same(from.person, second)) return { status: 'blocked', reason: 'Choose a different coworker.' };
  const owner = directory[normalizeName(from.person)];
  const candidate = directory[normalizeName(second)];
  if (!owner || !candidate || !owner.status || !candidate.status) {
    return { status: 'review', reason: 'Employment status or qualifications need verification.' };
  }
  const allowPrn = kind === 'trade' ? policy.allowPrnTrade : policy.allowPrnCoverage;
  if (!allowPrn && [owner.status, candidate.status].includes('PRN')) {
    return { status: 'blocked', reason: 'The current trade rules exclude PRN staff.' };
  }
  const candidates = [{ person: second, outgoing: to, incoming: from, profile: candidate }];
  if (kind === 'trade') candidates.push({ person: from.person, outgoing: from, incoming: to, profile: owner });
  const projections = [];
  for (const { person, outgoing, incoming, profile } of candidates) {
    if (!incoming || !profile.skills?.includes(incoming.shift)) {
      return { status: 'blocked', reason: 'The required shift qualification is missing.' };
    }
    const source = roster.filter(item => same(item.person, person) && item.key !== outgoing?.key);
    const [start, end] = shiftInterval(incoming);
    if (source.some(item => {
      const [otherStart, otherEnd] = shiftInterval(item);
      return start < otherEnd && otherStart < end;
    })) return { status: 'blocked', reason: 'The proposed shift overlaps an existing assignment.' };
    const totals = new Map();
    for (const item of [...source, incoming]) {
      for (const [week, minutes] of minutesByWeek(item)) totals.set(week, (totals.get(week) || 0) + minutes);
    }
    const touched = new Set([...minutesByWeek(incoming), ...(outgoing ? minutesByWeek(outgoing) : [])].map(([week]) => week));
    const relevant = [...totals].filter(([week]) => touched.has(week)).sort();
    if (relevant.some(([, minutes]) => minutes > policy.overtimeLimitMinutes) &&
        !(kind === 'trade' ? policy.allowOvertimeTrade : policy.allowOvertimeCoverage)) {
      return { status: 'blocked', reason: 'The imported roster projects overtime in a touched payroll week.' };
    }
    projections.push({ person, weeks: relevant });
  }
  if (!hoursVerified) return { status: 'review', reason: 'Hours and pickups outside this roster need verification.', projections };
  return { status: 'eligible', reason: 'Roster-based checks passed.', projections };
}
