// The department's shifts and rules in the shape src/trades.js already reads, so the server checks an exchange with
// the same arithmetic the phone does rather than a second, thinner copy of the rules.
//
// Why this file exists: the first version of the acceptance route checked that the shift being moved still belonged
// to the person offering it and was at the revision the proposal was built against. That is not enough. A recipient
// can pick up an unrelated shift after the proposal is made, and then the trade puts them on two shifts at once;
// the thing being moved never changed, so checking only it finds nothing wrong. The real checks — overlap, rest,
// weekly hours, qualifications, a shift that has already started, a shift already promised elsewhere — live in
// src/trades.js, and this hands them the current records.
import { POLICY, normalizeName } from '../src/model.js';
import { checkExchange, exchangeBasis } from '../src/trades.js';

export { checkExchange, exchangeBasis };

const policyOf = department => {
  let stored = {};
  try { stored = JSON.parse(department?.policy || '{}'); } catch { stored = {}; }
  return { ...POLICY, ...stored, version: department?.rules_revision || POLICY.version };
};

// Every assignment in the department, keyed by its stable row ID rather than by date-shift-person, so a key does
// not change under a move. `committed` is every shift already promised by an agreed exchange.
export function tradeWorld(db, departmentId, { now = new Date().toISOString() } = {}) {
  const department = db.prepare('SELECT * FROM departments WHERE id = ?').get(departmentId);
  const names = new Map(db.prepare(`SELECT p.id, p.name FROM memberships m JOIN people p ON p.id = m.person_id
    WHERE m.department_id = ?`).all(departmentId).map(row => [row.id, row.name]));
  const roster = db.prepare('SELECT * FROM assignments WHERE department_id = ? ORDER BY date, shift').all(departmentId)
    .map(row => ({ key: row.id, date: row.date, shift: row.shift, person: names.get(row.person_id) || row.person_id,
      ...(row.role ? { role: row.role } : {}), ...(row.hours ? { hours: row.hours } : {}) }));
  const directory = {};
  for (const row of db.prepare(`SELECT p.id, p.name, pr.status, pr.skills FROM memberships m JOIN people p ON p.id = m.person_id
    LEFT JOIN profiles pr ON pr.person_id = p.id WHERE m.department_id = ? AND m.revoked_at IS NULL AND m.activated_at IS NOT NULL`).all(departmentId)) {
    let skills = [];
    try { skills = JSON.parse(row.skills || '[]'); } catch { skills = []; }
    directory[normalizeName(row.name)] = { person: row.name, status: row.status || null, skills };
  }
  const committed = db.prepare(`SELECT moves FROM exchanges WHERE department_id = ? AND committed_at IS NOT NULL`).all(departmentId)
    .flatMap(row => { try { return JSON.parse(row.moves).map(move => move.assignmentId); } catch { return []; } });
  return { roster, directory, policy: policyOf(department), committed, today: now.slice(0, 10), now, names };
}

// The moves of a stored exchange in src/trades.js terms: { key: assignment row ID, to: recipient's name }.
export const movesFor = (stored, names) => stored.map(move => ({ key: move.assignmentId, to: names.get(move.toPersonId) || move.toPersonId }));
