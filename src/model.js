export const SHIFTS = {
  D: { label: 'Day', start: '07:00', end: '19:00' },
  N: { label: 'Night', start: '19:00', end: '07:00' }
};

export const POLICY = {
  version: 'pilot-3',
  source: 'Illustrative department rules',
  zone: 'America/Indiana/Indianapolis',
  overtimeLimitMinutes: 40 * 60,
  minimumRestMinutes: 8 * 60,
  minimumByShift: { D: 4, N: 3 },
  allowPrnTrade: false,
  allowPrnCoverage: true,
  allowStudents: false,
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

// A partial shift is written on the schedule as "7-3" or "7-3:30". On a day page that is 07:00 to 15:00.
// On a night page it is 19:00 to 03:00.
export function shiftTimes(item) {
  const base = SHIFTS[item.shift];
  if (!base) throw new Error('Unsupported shift label');
  const match = item.hours && /^(\d{1,2})(?::(\d{2}))?-(\d{1,2})(?::(\d{2}))?/.exec(item.hours);
  if (!match) return base;
  const night = item.shift === 'N';
  const clock = (hour, minute) => String(hour % 24).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  let start = Number(match[1]) % 12, end = Number(match[3]) % 12;
  const startMinute = Number(match[2] || 0), endMinute = Number(match[4] || 0);
  if (night || start < 5) start += 12;
  if (night ? end + 12 > start : end * 60 + endMinute <= start * 60 + startMinute) end += 12;
  return { label: base.label, start: clock(start, startMinute), end: clock(end, endMinute) };
}

export function shiftInterval(item) {
  const shift = shiftTimes(item);
  const endDate = shift.end > shift.start ? item.date : addDays(item.date, 1);
  return [zonedInstant(item.date, shift.start), zonedInstant(endDate, shift.end)];
}

// The pay week a date falls in, named by its first day. startDay is 0 for Sunday through 6 for Saturday.
export const payWeekStart = (date, startDay = 0) => addDays(date, -((new Date(date + 'T12:00:00Z').getUTCDay() - startDay + 7) % 7));

export function minutesByWeek(item, startDay = 0) {
  const [start, end] = shiftInterval(item);
  const week = payWeekStart(item.date, startDay);
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

// Turns what was typed into name boxes into a clean list with one person per line.
// - A box that holds several people is split: commas, slashes, semicolons, new lines, "and", or several known names in
//   a row ("Avery Blair"). A known name that contains a space ("Jordan K") is never split.
// - A name entered twice is kept once. The first line wins and takes a role or hours from the repeat if it had none.
// - A name that matches a known one takes the known spelling.
// entries: [{ person, role, hours }]. Returns { rows, split, duplicates, fresh }, the last three for telling the user.
export function tidyNames(entries, known = []) {
  const spelling = new Map(known.map(name => [normalizeName(name), name.trim().replace(/\s+/g, ' ')]));
  const segment = text => {
    if (spelling.has(normalizeName(text))) return [spelling.get(normalizeName(text))];
    const words = text.split(' ');
    const walk = start => {                 // longest known name first, and only if the whole box is used up
      if (start === words.length) return [];
      for (let end = words.length; end > start; end--) {
        const name = spelling.get(normalizeName(words.slice(start, end).join(' ')));
        const rest = name && walk(end);
        if (rest) return [name, ...rest];
      }
      return null;
    };
    const found = words.length > 1 ? walk(0) : null;
    return found && found.length > 1 ? found : [text];
  };
  const rows = [], split = [], duplicates = [], fresh = [];
  for (const entry of entries) {
    const typed = String(entry.person || '').trim();
    if (!typed) continue;
    const names = typed.split(/[,;\/\n]+|\s+(?:and|&)\s+/i).map(part => part.trim().replace(/\s+/g, ' ')).filter(Boolean).flatMap(segment);
    if (names.length > 1) split.push(typed.replace(/\s+/g, ' '));
    names.forEach((person, position) => {
      const details = position === 0 ? { ...(entry.role ? { role: entry.role } : {}), ...(entry.hours ? { hours: entry.hours } : {}) } : {};
      const same = rows.find(row => normalizeName(row.person) === normalizeName(person));
      if (same) {
        if (!duplicates.includes(same.person)) duplicates.push(same.person);
        if (!same.role && details.role) same.role = details.role;
        if (!same.hours && details.hours) same.hours = details.hours;
        return;
      }
      if (!spelling.has(normalizeName(person))) fresh.push(person);
      rows.push({ person, ...details });
    });
  }
  return { rows, split, duplicates, fresh };
}

// One sentence for each thing tidyNames changed, for a notice.
export function tidyNotes({ split, duplicates, fresh }) {
  const list = names => names.length < 3 ? names.join(' and ') : names.slice(0, -1).join(', ') + ' and ' + names.at(-1);
  return [
    duplicates.length ? list(duplicates) + (duplicates.length === 1 ? ' was' : ' were') + ' entered twice and ' + (duplicates.length === 1 ? 'is' : 'are') + ' listed once.' : '',
    split.length ? 'A line with several names was split so each person has a line: ' + split.join('; ') + '.' : '',
    fresh.length ? (fresh.length === 1 ? 'New name' : 'New names') + ': ' + list(fresh) + '. Check the spelling.' : ''
  ].filter(Boolean);
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
  // A batch can hold day pages only or night pages only. A shift the batch never mentions is not a gap.
  const present = Object.keys(SHIFTS).filter(shift => rows.some(row => row.shift === shift));
  for (const [date, group] of Map.groupBy(rows, row => row.date)) {
    for (const shift of present) {
      const count = group.filter(row => row.shift === shift).length;
      if (count !== policy.minimumByShift[shift]) {
        issues.push({ date, message: SHIFTS[shift].label + ' shift has ' + count + ' assignments. Sample target is ' + policy.minimumByShift[shift] + '.' });
      }
    }
  }
  return issues;
}

const same = (left, right) => normalizeName(left) === normalizeName(right);

export const AGREED_STATUS = 'Both agreed · queued for review';
// An exchange is a request with any number of moves, each handing one assignment to one person. Everyone in it agrees.
export const EXCHANGE_AGREED = 'All agreed · queued for review';
const isAgreed = request => request.status === AGREED_STATUS || request.status === EXCHANGE_AGREED;

// Assignment keys that already belong to an agreed request. A shift can be agreed once.
export function committedKeys(requests = [], exceptId = null) {
  return requests.filter(request => isAgreed(request) && request.id !== exceptId)
    .flatMap(request => request.moves ? request.moves.map(move => move.key) : [request.from?.key, request.to?.key]).filter(Boolean);
}

// The imported roster with every agreed request applied. Each row keeps its original key,
// so hours, overlap and rest checks count changes that are agreed but not yet in the official system.
export function projectRoster(roster, requests = []) {
  const holder = new Map();
  for (const request of requests) {
    if (!isAgreed(request)) continue;
    if (request.moves) { for (const move of request.moves) holder.set(move.key, move.to); continue; }
    if (!request.from?.key) continue;
    holder.set(request.from.key, request.recipient);
    if (request.to?.key) holder.set(request.to.key, request.from.person);
  }
  return holder.size ? roster.map(item => holder.has(item.key) ? { ...item, person: holder.get(item.key) } : item) : roster;
}

export function evaluateChange({ roster, from, to, recipient, kind, directory, hoursVerified = false, policy = POLICY, committed = [] }) {
  const second = kind === 'trade' ? to?.person : recipient;
  if (!second || same(from.person, second)) return { status: 'blocked', reason: 'Choose a different coworker.' };
  const taken = new Set(committed);
  if ([from, to].some(item => item && taken.has(item.key))) {
    return { status: 'blocked', reason: 'One of these shifts is already part of an agreed request.' };
  }
  const owner = directory[normalizeName(from.person)];
  const candidate = directory[normalizeName(second)];
  // Unknown staff details lower the result to review. They never skip the roster checks below.
  const unknown = [owner, candidate].some(profile => !profile?.status);
  const allowPrn = kind === 'trade' ? policy.allowPrnTrade : policy.allowPrnCoverage;
  if (!allowPrn && [owner?.status, candidate?.status].includes('PRN')) {
    return { status: 'blocked', reason: 'The current trade rules exclude PRN staff.' };
  }
  if (!policy.allowStudents && [owner?.status, candidate?.status].includes('Student')) {
    return { status: 'blocked', reason: 'Students are not part of trades or coverage.' };
  }
  const candidates = [{ person: second, outgoing: to, incoming: from, profile: candidate }];
  if (kind === 'trade') candidates.push({ person: from.person, outgoing: from, incoming: to, profile: owner });
  const rest = (policy.minimumRestMinutes || 0) * 60000;
  const projections = [];
  for (const { person, outgoing, incoming, profile } of candidates) {
    if (!incoming || (profile?.status && !profile.skills?.includes(incoming.shift))) {
      return { status: 'blocked', reason: 'The required shift qualification is missing.' };
    }
    const source = roster.filter(item => same(item.person, person) && item.key !== outgoing?.key);
    const [start, end] = shiftInterval(incoming);
    const others = source.map(shiftInterval);
    if (others.some(([otherStart, otherEnd]) => start < otherEnd && otherStart < end)) {
      return { status: 'blocked', reason: 'The proposed shift overlaps an existing assignment.' };
    }
    if (rest && others.some(([otherStart, otherEnd]) => Math.max(start - otherEnd, otherStart - end) < rest)) {
      return { status: 'blocked', reason: 'The change would leave ' + person + ' back to back with another shift.' };
    }
    const totals = new Map();
    for (const item of [...source, incoming]) {
      for (const [week, minutes] of minutesByWeek(item, policy.weekStartsOn || 0)) totals.set(week, (totals.get(week) || 0) + minutes);
    }
    const touched = new Set([...minutesByWeek(incoming, policy.weekStartsOn || 0), ...(outgoing ? minutesByWeek(outgoing, policy.weekStartsOn || 0) : [])].map(([week]) => week));
    const relevant = [...totals].filter(([week]) => touched.has(week)).sort();
    if (relevant.some(([, minutes]) => minutes > policy.overtimeLimitMinutes) &&
        !(kind === 'trade' ? policy.allowOvertimeTrade : policy.allowOvertimeCoverage)) {
      return { status: 'blocked', reason: 'The imported roster projects overtime in a touched payroll week.' };
    }
    projections.push({ person, weeks: relevant });
  }
  if (unknown) return { status: 'review', reason: 'Employment status or qualifications need verification.', projections };
  if (!hoursVerified) return { status: 'review', reason: 'Hours and pickups outside this roster need verification.', projections };
  return { status: 'eligible', reason: 'Roster-based checks passed.', projections };
}
