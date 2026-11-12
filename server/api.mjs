// The department's HTTP surface.
//
// Shape: everything about a department lives beneath /api/departments/:departmentId, and a request is answered only
// when the caller's own session belongs to that department. A caller who names another department, or a record that
// belongs to one, is answered 404 — the same answer they get for a record that does not exist, so the response does
// not reveal which it was.
//
// Nothing in a request body or query string decides who the caller is. An authorId, departmentId, personId, keeper
// flag or X-Actor header in a request is either refused or ignored; the server uses the session.
import { ask } from '../src/ask.js';
import { newId, now, recordReceipt, transact } from './db.mjs';
import { canAdministerMembership, canExportNamedRecords, canReadNamedFairness, directoryPerson, phoneFor } from './visibility.mjs';
import { revokeSessionsFor } from './auth.mjs';
import { askWorld, search, sourcesFor } from './world.mjs';

// A refusal carries no detail about the thing refused.
export class Refused extends Error {
  constructor(status, message = 'not available') { super(message); this.status = status; }
}
const notFound = () => { throw new Refused(404, 'not found'); };
const forbidden = () => { throw new Refused(403, 'not permitted'); };
const badRequest = message => { throw new Refused(400, message); };

const postJson = row => ({ id: row.id, departmentId: row.department_id, authorId: row.author_id, body: row.body, createdAt: row.created_at, editedAt: row.edited_at ?? null });
const messageJson = row => ({ id: row.id, conversationId: row.conversation_id, authorId: row.author_id, body: row.body, createdAt: row.created_at });

function member(db, departmentId, personId) {
  return db.prepare('SELECT * FROM memberships WHERE department_id = ? AND person_id = ? AND revoked_at IS NULL AND activated_at IS NOT NULL').get(departmentId, personId);
}
function personRow(db, departmentId, personId) {
  if (!member(db, departmentId, personId)) return null;
  return db.prepare(`SELECT p.id, p.id AS person_id, p.name, pr.phone, pr.share_phone FROM people p
    LEFT JOIN profiles pr ON pr.person_id = p.id WHERE p.id = ?`).get(personId) || null;
}
const participates = (db, conversationId, personId) =>
  Boolean(db.prepare('SELECT 1 FROM conversation_people WHERE conversation_id = ? AND person_id = ?').get(conversationId, personId));

function exchangeJson(db, row) {
  const people = db.prepare('SELECT * FROM exchange_people WHERE exchange_id = ? ORDER BY person_id').all(row.id);
  return { id: row.id, departmentId: row.department_id, conversationId: row.conversation_id, moves: JSON.parse(row.moves), basis: JSON.parse(row.basis),
    status: row.status, createdAt: row.created_at, committedAt: row.committed_at ?? null,
    people: people.map(entry => entry.person_id), acceptedBy: people.filter(entry => entry.accepted_at).map(entry => entry.person_id) };
}

// ---- the routes -------------------------------------------------------------------------------------------------

export function handle(db, { session, departmentId, parts, method, query, body, build }) {
  const [kind, first, second] = parts;
  const dept = departmentId;
  const json = value => ({ status: 200, body: value });

  if (kind === 'posts') {
    if (!first) {
      if (method === 'GET') return json(db.prepare('SELECT * FROM posts WHERE department_id = ? AND deleted_at IS NULL ORDER BY created_at').all(dept).map(postJson));
      if (method === 'POST') {
        const text = String(body?.body ?? '').trim();
        if (!text) badRequest('a post needs words');
        // An authorId or departmentId in the body is refused rather than quietly honoured, so a client cannot
        // discover that forging one is merely ineffective.
        if (body.authorId && body.authorId !== session.personId) badRequest('authorship comes from the session');
        if (body.departmentId && body.departmentId !== dept) badRequest('the department comes from the session');
        const row = transact(db, () => {
          const id = newId('post'), at = now();
          db.prepare('INSERT INTO posts (id, department_id, author_id, body, created_at) VALUES (?,?,?,?,?)').run(id, dept, session.personId, text, at);
          recordReceipt(db, { departmentId: dept, actorId: session.personId, type: 'Board update', details: { id, length: text.length }, build });
          return db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
        });
        return { status: 201, body: postJson(row) };
      }
      forbidden();
    }
    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(first);
    if (!row || row.department_id !== dept || row.deleted_at) notFound();
    if (method === 'GET') return json(postJson(row));
    if (row.author_id !== session.personId) forbidden();
    if (method === 'PATCH') {
      const text = String(body?.body ?? '').trim();
      if (!text) badRequest('a post needs words');
      const updated = transact(db, () => {
        db.prepare('UPDATE posts SET body = ?, edited_at = ? WHERE id = ?').run(text, now(), row.id);
        recordReceipt(db, { departmentId: dept, actorId: session.personId, type: 'Board post edited', details: { id: row.id }, build });
        return db.prepare('SELECT * FROM posts WHERE id = ?').get(row.id);
      });
      return json(postJson(updated));
    }
    if (method === 'DELETE') {
      transact(db, () => {
        db.prepare('UPDATE posts SET deleted_at = ? WHERE id = ?').run(now(), row.id);
        recordReceipt(db, { departmentId: dept, actorId: session.personId, type: 'Board post removed', details: { id: row.id }, build });
      });
      return { status: 204, body: null };
    }
    forbidden();
  }

  if (kind === 'documents') {
    if (!first) return json(db.prepare('SELECT * FROM documents WHERE department_id = ? ORDER BY added_at').all(dept)
      .map(row => ({ id: row.id, departmentId: row.department_id, title: row.title, kind: row.kind, effective: row.effective })));
    const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(first);
    if (!row || row.department_id !== dept) notFound();
    return json({ id: row.id, departmentId: row.department_id, title: row.title, kind: row.kind, effective: row.effective, body: row.body, addedAt: row.added_at });
  }

  if (kind === 'directory') {
    const rows = db.prepare(`SELECT p.id, p.id AS person_id, p.name, pr.phone, pr.share_phone
      FROM memberships m JOIN people p ON p.id = m.person_id LEFT JOIN profiles pr ON pr.person_id = p.id
      WHERE m.department_id = ? AND m.revoked_at IS NULL AND m.activated_at IS NOT NULL ORDER BY p.name`).all(dept);
    if (!first) return json(rows.map(row => directoryPerson(session, row)));
    const one = rows.find(row => row.person_id === first);
    if (!one) notFound();
    return json(directoryPerson(session, one));
  }

  // Your own contact record, and nobody else's. A personId anywhere in the request is refused.
  if (kind === 'profile') {
    if (query.personId && query.personId !== session.personId) {
      // Reading is answered with the caller's own record rather than refused, so a mistaken link still works.
      if (method !== 'GET') badRequest('a profile change applies to your own record');
    }
    const self = () => {
      const row = personRow(db, dept, session.personId);
      if (!row) notFound();
      return { personId: row.person_id, name: row.name, phone: row.phone ?? null, sharePhone: Boolean(row.share_phone) };
    };
    if (method === 'GET') return json(self());
    if (method === 'PATCH') {
      if (body?.personId && body.personId !== session.personId) badRequest('a profile change applies to your own record');
      const current = self();
      const phone = body?.phone === undefined ? current.phone : (body.phone === null || body.phone === '' ? null : String(body.phone).replace(/\D/g, ''));
      if (phone !== null && !/^\d{10,15}$/.test(phone)) badRequest('a phone number is ten to fifteen digits, or null');
      const sharePhone = body?.sharePhone === undefined ? current.sharePhone : Boolean(body.sharePhone);
      const updated = transact(db, () => {
        db.prepare(`INSERT INTO profiles (person_id, phone, share_phone) VALUES (?,?,?)
          ON CONFLICT(person_id) DO UPDATE SET phone = excluded.phone, share_phone = excluded.share_phone`).run(session.personId, phone, sharePhone ? 1 : 0);
        // The receipt records that sharing changed. It never records the number.
        if (sharePhone !== current.sharePhone || (phone === null) !== (current.phone === null))
          recordReceipt(db, { departmentId: dept, actorId: session.personId, type: 'Contact sharing changed', details: { sharePhone, hasNumber: phone !== null }, build });
        return personRow(db, dept, session.personId);
      });
      return json({ personId: updated.person_id, name: updated.name, phone: updated.phone ?? null, sharePhone: Boolean(updated.share_phone) });
    }
    forbidden();
  }

  if (kind === 'files') {
    if (!first) notFound();
    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(first);
    if (!row || row.department_id !== dept) notFound();
    if (row.conversation_id && !participates(db, row.conversation_id, session.personId)) notFound();
    return { status: 200, bytes: Buffer.from(row.bytes), contentType: row.content_type, name: row.name };
  }

  if (kind === 'conversations') {
    if (!first) {
      return json(db.prepare(`SELECT c.* FROM conversations c JOIN conversation_people cp ON cp.conversation_id = c.id
        WHERE c.department_id = ? AND cp.person_id = ? ORDER BY c.created_at`).all(dept, session.personId)
        .map(row => ({ id: row.id, departmentId: row.department_id, subject: row.subject, createdAt: row.created_at })));
    }
    const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(first);
    if (!row || row.department_id !== dept) notFound();
    if (!participates(db, row.id, session.personId)) notFound();
    if (second === 'messages' && method === 'POST') {
      const text = String(body?.body ?? '').trim();
      if (!text) badRequest('a message needs words');
      if (body.authorId && body.authorId !== session.personId) badRequest('authorship comes from the session');
      if (body.personId && body.personId !== session.personId) badRequest('authorship comes from the session');
      const message = transact(db, () => {
        const id = newId('message'), at = now();
        db.prepare('INSERT INTO messages (id, conversation_id, author_id, body, created_at) VALUES (?,?,?,?,?)').run(id, row.id, session.personId, text, at);
        return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
      });
      return { status: 201, body: messageJson(message) };
    }
    if (second) notFound();
    const people = db.prepare('SELECT person_id FROM conversation_people WHERE conversation_id = ? ORDER BY person_id').all(row.id);
    const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, id').all(row.id);
    return json({ id: row.id, departmentId: row.department_id, subject: row.subject, createdAt: row.created_at,
      participants: people.map(entry => entry.person_id), messages: messages.map(messageJson) });
  }

  if (kind === 'exchanges') {
    if (!first) notFound();
    const row = db.prepare('SELECT * FROM exchanges WHERE id = ?').get(first);
    if (!row || row.department_id !== dept) notFound();
    const involved = db.prepare('SELECT 1 FROM exchange_people WHERE exchange_id = ? AND person_id = ?').get(row.id, session.personId);
    if (!involved) notFound();
    if (!second && method === 'GET') return json(exchangeJson(db, row));
    if (second === 'accept' && method === 'POST') {
      if (body?.personId && body.personId !== session.personId) badRequest('an acceptance is recorded for the person who sent it');
      const updated = transact(db, () => {
        const fresh = db.prepare('SELECT * FROM exchanges WHERE id = ?').get(row.id);
        if (fresh.committed_at) throw new Refused(409, 'already settled');
        // The proposal was checked against a roster and rule revision. If either has moved, it is stale and the
        // acceptance is refused rather than committed on facts that no longer hold.
        const basis = JSON.parse(fresh.basis);
        const revision = db.prepare('SELECT COALESCE(MAX(revision),0) AS revision FROM assignments WHERE department_id = ?').get(dept).revision;
        if (basis.rosterRevision !== undefined && basis.rosterRevision !== revision) throw new Refused(409, 'the schedule changed since this was proposed');
        db.prepare('UPDATE exchange_people SET accepted_at = ? WHERE exchange_id = ? AND person_id = ? AND accepted_at IS NULL').run(now(), fresh.id, session.personId);
        const people = db.prepare('SELECT * FROM exchange_people WHERE exchange_id = ?').all(fresh.id);
        const settled = people.length > 0 && people.every(entry => entry.accepted_at);
        if (settled) {
          db.prepare("UPDATE exchanges SET status = 'Agreed', committed_at = ? WHERE id = ?").run(now(), fresh.id);
          for (const move of JSON.parse(fresh.moves)) {
            const assignment = db.prepare('SELECT * FROM assignments WHERE id = ? AND department_id = ?').get(move.assignmentId, dept);
            if (!assignment) throw new Refused(409, 'the shift in this exchange is no longer on the schedule');
            if (assignment.person_id !== move.fromPersonId) throw new Refused(409, 'the shift has changed hands since this was proposed');
            db.prepare('UPDATE assignments SET person_id = ?, revision = revision + 1 WHERE id = ?').run(move.toPersonId, assignment.id);
          }
        }
        recordReceipt(db, { departmentId: dept, actorId: session.personId, type: settled ? 'Exchange agreed' : 'Exchange acceptance recorded',
          details: { id: fresh.id, by: session.personId, settled }, build });
        return db.prepare('SELECT * FROM exchanges WHERE id = ?').get(fresh.id);
      });
      return json(exchangeJson(db, updated));
    }
    notFound();
  }

  if (kind === 'fairness') {
    if (!first) notFound();
    if (!personRow(db, dept, first)) notFound();
    if (!canReadNamedFairness(session, first)) forbidden();
    const row = db.prepare('SELECT f.*, p.name FROM fairness f JOIN people p ON p.id = f.person_id WHERE f.person_id = ? AND f.department_id = ?').get(first, dept);
    if (!row) notFound();
    return json({ personId: row.person_id, name: row.name, departmentId: dept, weekendTurns: row.weekend_turns, holidayTurns: row.holiday_turns });
  }

  if (kind === 'exports' && first === 'fairness') {
    if (!canExportNamedRecords(session)) forbidden();
    const people = db.prepare('SELECT f.*, p.name FROM fairness f JOIN people p ON p.id = f.person_id WHERE f.department_id = ? ORDER BY p.name').all(dept);
    recordReceipt(db, { departmentId: dept, actorId: session.personId, type: 'Named record exported', details: { kind: 'fairness', people: people.length }, build });
    // No contact numbers in a fairness export. It is a record of turns, not a phone list.
    return json({ departmentId: dept, generatedAt: now(), by: session.personId,
      people: people.map(row => ({ personId: row.person_id, name: row.name, weekendTurns: row.weekend_turns, holidayTurns: row.holiday_turns })) });
  }

  if (kind === 'exports' && first === 'directory') {
    const rows = db.prepare(`SELECT p.id, p.id AS person_id, p.name, pr.phone, pr.share_phone
      FROM memberships m JOIN people p ON p.id = m.person_id LEFT JOIN profiles pr ON pr.person_id = p.id
      WHERE m.department_id = ? AND m.revoked_at IS NULL AND m.activated_at IS NOT NULL ORDER BY p.name`).all(dept);
    recordReceipt(db, { departmentId: dept, actorId: session.personId, type: 'Directory exported', details: { people: rows.length }, build });
    return json({ departmentId: dept, generatedAt: now(), by: session.personId,
      people: rows.map(row => ({ personId: row.person_id, name: row.name, phone: phoneFor(session, row) })) });
  }

  if (kind === 'search') return json(search(db, session, query.q));

  if (kind === 'ask') {
    if (method !== 'POST') forbidden();
    const question = String(body?.question ?? '').trim();
    if (!question) badRequest('a question is needed');
    const { world, links } = askWorld(db, session, { today: query.today || undefined, seen: body?.seen || null });
    const found = ask(question, world);
    return json({ question, understood: found.understood || null, title: found.title, lines: found.lines || [],
      items: (found.items || []).map(item => ({ text: item.text, sub: item.sub || '' })),
      source: found.source, sources: sourcesFor(found, { links, personId: session.personId }) });
  }

  if (kind === 'memberships') {
    if (!first) notFound();
    if (!canAdministerMembership(session)) forbidden();
    const row = db.prepare('SELECT * FROM memberships WHERE id = ?').get(first);
    if (!row || row.department_id !== dept || row.revoked_at || !row.activated_at) notFound();
    if (method === 'PATCH') {
      const roles = Array.isArray(body?.roles) ? [...new Set(body.roles.map(String))] : null;
      if (!roles || !roles.length) badRequest('roles is a list');
      if (!roles.every(role => ['member', 'custodian', 'admin'].includes(role))) badRequest('unknown role');
      transact(db, () => {
        db.prepare('UPDATE memberships SET roles = ? WHERE id = ?').run(JSON.stringify(roles.sort()), row.id);
        recordReceipt(db, { departmentId: dept, actorId: session.personId, type: 'Roles changed', details: { membershipId: row.id, person: row.person_id, roles: roles.sort() }, build });
      });
      return json({ id: row.id, personId: row.person_id, departmentId: dept, roles: roles.sort() });
    }
    if (method === 'DELETE') {
      transact(db, () => {
        db.prepare('UPDATE memberships SET revoked_at = ? WHERE id = ?').run(now(), row.id);
        revokeSessionsFor(db, row.id);
        recordReceipt(db, { departmentId: dept, actorId: session.personId, type: 'Membership revoked', details: { membershipId: row.id, person: row.person_id }, build });
      });
      return { status: 204, body: null };
    }
    forbidden();
  }

  if (kind === 'assignments') {
    return json(db.prepare('SELECT * FROM assignments WHERE department_id = ? ORDER BY date, shift').all(dept)
      .map(row => ({ id: row.id, date: row.date, shift: row.shift, personId: row.person_id, role: row.role, hours: row.hours, revision: row.revision })));
  }

  if (kind === 'receipts') {
    return json(db.prepare('SELECT * FROM receipts WHERE department_id = ? ORDER BY at, id').all(dept)
      .map(row => ({ id: row.id, type: row.type, actorId: row.actor_id, details: JSON.parse(row.details), previousHash: row.previous_hash, hash: row.hash, build: row.build, at: row.at })));
  }

  notFound();
}
