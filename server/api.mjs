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
import { newId, now, recordReceipt, transact, verifyReceipts } from './db.mjs';
import { canAdministerMembership, canExportNamedRecords, canReadNamedFairness, directoryPerson, phoneFor } from './visibility.mjs';
import { revokeSessionsFor } from './auth.mjs';
import { askWorld, search, sourcesFor } from './world.mjs';
import { checkExchange, movesFor, tradeWorld } from './trades.mjs';

// A refusal carries no detail about the thing refused.
export class Refused extends Error {
  constructor(status, message = 'not available') { super(message); this.status = status; }
}
const notFound = () => { throw new Refused(404, 'not found'); };
const forbidden = () => { throw new Refused(403, 'not permitted'); };
const badRequest = message => { throw new Refused(400, message); };

// What kind of post it is, as the phone's board shows it. Only these keys, each checked, and nothing free-form.
const WHEN_KINDS = ['due', 'meeting', 'event'];
const REACTION_KINDS = ['laugh', 'thanks'];
export function postExtras(value = {}) {
  const extras = {};
  if (value.learning === true) extras.learning = true;
  if (value.inside === true) extras.inside = true;
  if (value.voice === true) extras.voice = true;
  if (value.contest === true) extras.contest = true;
  if (value.seconds !== undefined) {
    const seconds = Number(value.seconds);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) badRequest('seconds is a recording length');
    extras.seconds = Math.round(seconds * 10) / 10;
  }
  if (value.when !== undefined && value.when !== null) {
    if (!WHEN_KINDS.includes(value.when.kind) || !/^\d{4}-\d{2}-\d{2}$/.test(String(value.when.date || ''))) badRequest('when is a kind and a date');
    extras.when = { kind: value.when.kind, date: value.when.date };
  }
  return extras;
}
const readExtras = text => { try { return text ? JSON.parse(text) : {}; } catch { return {}; } };
const postJson = (row, media = []) => ({ id: row.id, departmentId: row.department_id, authorId: row.author_id, body: row.body,
  clientId: row.client_id ?? null, createdAt: row.created_at, editedAt: row.edited_at ?? null, extras: readExtras(row.extras),
  media: media.map(file => ({ id: file.id, name: file.name, contentType: file.content_type, bytes: file.bytes?.length ?? file.size ?? null })) });
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

  const mediaOf = postId => db.prepare('SELECT id, name, content_type, LENGTH(bytes) AS size FROM files WHERE post_id = ? ORDER BY created_at').all(postId);
  // How many laughed or thanked, and whether the caller did. Never who: a count is enough, and it ranks nobody.
  const reactionsOf = targetId => Object.fromEntries(REACTION_KINDS.map(kind => [kind, {
    count: db.prepare('SELECT COUNT(*) AS n FROM reactions WHERE target_id = ? AND kind = ?').get(targetId, kind).n,
    mine: Boolean(db.prepare('SELECT 1 FROM reactions WHERE target_id = ? AND kind = ? AND person_id = ?').get(targetId, kind, session.personId)) }]));
  const captionsOf = postId => db.prepare('SELECT * FROM captions WHERE post_id = ? AND deleted_at IS NULL ORDER BY created_at').all(postId)
    .map(row => ({ id: row.id, authorId: row.author_id, body: row.body, createdAt: row.created_at, reactions: { laugh: reactionsOf(row.id).laugh } }));
  const full = row => ({ ...postJson(row, mediaOf(row.id)), reactions: reactionsOf(row.id), captions: captionsOf(row.id) });
  // PUT gives a reaction, DELETE takes it back. Both are safe to repeat, so a retry on a bad signal does no harm.
  // A reaction leaves no receipt: it is a tap, not a record.
  const react = (targetId, kind, allowed = REACTION_KINDS) => {
    if (!allowed.includes(kind)) notFound();
    if (method === 'PUT') db.prepare('INSERT OR IGNORE INTO reactions (target_id, department_id, person_id, kind, created_at) VALUES (?,?,?,?,?)').run(targetId, dept, session.personId, kind, now());
    else if (method === 'DELETE') db.prepare('DELETE FROM reactions WHERE target_id = ? AND person_id = ? AND kind = ?').run(targetId, session.personId, kind);
    else forbidden();
    return json(reactionsOf(targetId)[kind]);
  };

  if (kind === 'posts') {
    if (!first) {
      if (method === 'GET') return json(db.prepare('SELECT * FROM posts WHERE department_id = ? AND deleted_at IS NULL ORDER BY created_at').all(dept).map(full));
      if (method === 'POST') {
        const text = String(body?.body ?? '').trim();
        const media = Array.isArray(body.media) ? body.media.map(String) : [];
        // Words, or at least one attachment: a voice message or a photo can stand on its own.
        if (!text && !media.length) badRequest('a post needs words or an attachment');
        if (text.length > 2000) badRequest('a post is at most 2000 characters');
        const extras = postExtras(body.extras || {});
        // An authorId or departmentId in the body is refused rather than quietly honoured, so a client cannot
        // discover that forging one is merely ineffective.
        if (body.authorId && body.authorId !== session.personId) badRequest('authorship comes from the session');
        if (body.departmentId && body.departmentId !== dept) badRequest('the department comes from the session');
        const clientId = body.clientId === undefined || body.clientId === null ? null : String(body.clientId);
        if (clientId !== null && !/^[A-Za-z0-9_.:-]{1,128}$/.test(clientId)) badRequest('clientId is a short plain identifier');
        // A retry of a post that already arrived returns the post, not a second one.
        if (clientId !== null) {
          const already = db.prepare('SELECT * FROM posts WHERE department_id = ? AND client_id = ?').get(dept, clientId);
          if (already) return { status: 200, body: { ...full(already), duplicate: true } };
        }
        const row = transact(db, () => {
          const id = newId('post'), at = now();
          db.prepare('INSERT INTO posts (id, department_id, author_id, body, client_id, created_at, extras) VALUES (?,?,?,?,?,?,?)')
            .run(id, dept, session.personId, text, clientId, at, Object.keys(extras).length ? JSON.stringify(extras) : null);
          for (const mediaId of media) {
            // Only this person's own just-uploaded attachments, from this department, not yet on another post.
            const file = db.prepare('SELECT * FROM files WHERE id = ? AND department_id = ? AND post_id IS NULL AND conversation_id IS NULL').get(mediaId, dept);
            if (!file) throw new Refused(400, 'one of those attachments is not available to attach');
            if (file.author_id !== session.personId) throw new Refused(403, 'an attachment is attached by whoever uploaded it');
            db.prepare('UPDATE files SET post_id = ? WHERE id = ?').run(id, mediaId);
          }
          recordReceipt(db, { departmentId: dept, actorId: session.personId, type: 'Board update', details: { id, length: text.length, attachments: media.length }, build });
          return db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
        });
        return { status: 201, body: full(row) };
      }
      forbidden();
    }
    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(first);
    if (!row || row.department_id !== dept || row.deleted_at) notFound();
    if (method === 'GET' && !second) return json(full(row));
    // Reactions and captions belong to everyone in the department, not only the post's author.
    if (second === 'reactions') return react(row.id, parts[3]);
    if (second === 'captions') {
      if (!parts[3] && method === 'POST') {
        const text = String(body?.body ?? '').trim().replace(/\s+/g, ' ');
        if (!text) badRequest('a caption needs words');
        if (text.length > 140) badRequest('a caption is at most 140 characters');
        if (!readExtras(row.extras).contest) badRequest('that post is not a caption contest');
        const id = newId('caption');
        transact(db, () => {
          db.prepare('INSERT INTO captions (id, post_id, department_id, author_id, body, created_at) VALUES (?,?,?,?,?,?)').run(id, row.id, dept, session.personId, text, now());
          recordReceipt(db, { departmentId: dept, actorId: session.personId, type: 'Caption added', details: { post: row.id, caption: id, length: text.length }, build });
        });
        return { status: 201, body: full(row) };
      }
      const caption = db.prepare('SELECT * FROM captions WHERE id = ? AND post_id = ? AND deleted_at IS NULL').get(String(parts[3] || ''), row.id);
      if (!caption) notFound();
      if (parts[4] === 'reactions') return react(caption.id, parts[5], ['laugh']);
      if (!parts[4] && method === 'DELETE') {
        if (caption.author_id !== session.personId) forbidden();
        transact(db, () => {
          db.prepare('UPDATE captions SET deleted_at = ? WHERE id = ?').run(now(), caption.id);
          db.prepare('DELETE FROM reactions WHERE target_id = ?').run(caption.id);
          recordReceipt(db, { departmentId: dept, actorId: session.personId, type: 'Caption removed', details: { post: row.id, caption: caption.id }, build });
        });
        return { status: 204, body: null };
      }
      notFound();
    }
    if (second) notFound();
    if (row.author_id !== session.personId) forbidden();
    if (method === 'PATCH') {
      const text = String(body?.body ?? '').trim();
      if (!text) badRequest('a post needs words');
      const updated = transact(db, () => {
        db.prepare('UPDATE posts SET body = ?, edited_at = ? WHERE id = ?').run(text, now(), row.id);
        recordReceipt(db, { departmentId: dept, actorId: session.personId, type: 'Board post edited', details: { id: row.id }, build });
        return db.prepare('SELECT * FROM posts WHERE id = ?').get(row.id);
      });
      return json(full(updated));
    }
    if (method === 'DELETE') {
      transact(db, () => {
        const attached = mediaOf(row.id);
        db.prepare('UPDATE posts SET deleted_at = ? WHERE id = ?').run(now(), row.id);
        // The post's own attachments go with it. Nothing else is touched.
        db.prepare('DELETE FROM files WHERE post_id = ?').run(row.id);
        db.prepare('DELETE FROM reactions WHERE target_id = ? OR target_id IN (SELECT id FROM captions WHERE post_id = ?)').run(row.id, row.id);
        db.prepare('UPDATE captions SET deleted_at = ? WHERE post_id = ? AND deleted_at IS NULL').run(now(), row.id);
        recordReceipt(db, { departmentId: dept, actorId: session.personId, type: 'Board post removed', details: { id: row.id, attachments: attached.length }, build });
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
    const rows = db.prepare(`SELECT p.id, p.id AS person_id, p.name, pr.phone, pr.share_phone, m.id AS membership_id, m.roles
      FROM memberships m JOIN people p ON p.id = m.person_id LEFT JOIN profiles pr ON pr.person_id = p.id
      WHERE m.department_id = ? AND m.revoked_at IS NULL AND m.activated_at IS NOT NULL ORDER BY p.name`).all(dept);
    // An administrator also sees each membership's id and roles, which is what removing someone or changing a role
    // needs. Nobody else does.
    const shown = row => canAdministerMembership(session) ? { ...directoryPerson(session, row), membershipId: row.membership_id, roles: (() => { try { return JSON.parse(row.roles); } catch { return []; } })() } : directoryPerson(session, row);
    if (!first) return json(rows.map(shown));
    const one = rows.find(row => row.person_id === first);
    if (!one) notFound();
    return json(shown(one));
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
    if (!first && method === 'POST') {
      // An attachment arrives as raw bytes, so nothing is base64-inflated through JSON. It belongs to nobody's post
      // until a post names it, and only its uploader can name it.
      if (!body?.bytes) badRequest('send the attachment as the request body');
      const id = newId('file'), name = String(query.name || 'attachment');
      const contentType = String(query.contentType || body.contentType || 'application/octet-stream');
      transact(db, () => db.prepare('INSERT INTO files (id, department_id, author_id, name, content_type, bytes, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, dept, session.personId, name, contentType, body.bytes, now()));
      return { status: 201, body: { id, name, contentType, bytes: body.bytes.length } };
    }
    if (!first) notFound();
    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(first);
    if (!row || row.department_id !== dept) notFound();
    if (row.conversation_id && !participates(db, row.conversation_id, session.personId)) notFound();
    if (method === 'DELETE') {
      // Only the uploader, and only while it is not on a post yet.
      if (row.author_id !== session.personId || row.post_id) forbidden();
      transact(db, () => db.prepare('DELETE FROM files WHERE id = ?').run(row.id));
      return { status: 204, body: null };
    }
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
        const basis = JSON.parse(fresh.basis), stored = JSON.parse(fresh.moves);

        // 1. Every required participant, not only the caller. A trade with somebody who is no longer in the
        //    department cannot be honoured, so no acceptance is recorded for it.
        const required = db.prepare('SELECT person_id FROM exchange_people WHERE exchange_id = ?').all(fresh.id);
        for (const entry of required) {
          const theirs = db.prepare('SELECT * FROM memberships WHERE department_id = ? AND person_id = ? AND revoked_at IS NULL AND activated_at IS NOT NULL').get(dept, entry.person_id);
          if (!theirs) throw new Refused(409, 'somebody in this exchange is no longer a member of this department');
        }

        // 2. The cheap, specific checks, which give a clearer message than a general refusal.
        const department = db.prepare('SELECT * FROM departments WHERE id = ?').get(dept);
        if (basis.rulesRevision !== undefined && basis.rulesRevision !== department.rules_revision)
          throw new Refused(409, 'the trade rules changed since this was proposed');
        for (const move of stored) {
          const assignment = db.prepare('SELECT * FROM assignments WHERE id = ? AND department_id = ?').get(move.assignmentId, dept);
          if (!assignment) throw new Refused(409, 'a shift in this exchange is no longer on the schedule');
          if (assignment.person_id !== move.fromPersonId) throw new Refused(409, 'a shift has changed hands since this was proposed');
          const expected = basis.assignments?.[move.assignmentId];
          if (expected !== undefined && assignment.revision !== expected) throw new Refused(409, 'a shift in this exchange changed since this was proposed');
        }

        // 3. The whole exchange against the department's current records and rules, using the same arithmetic the
        //    phone uses. This is what catches a participant picking up an unrelated shift after the proposal was
        //    made: the shift being moved is untouched, but the person receiving it would now be on two at once.
        //    The stored trade basis covers the participants' own schedules, qualifications and the rules, so an
        //    unrelated person's trade elsewhere in the department does not invalidate this proposal.
        const world = tradeWorld(db, dept, { now: now() });
        const moves = movesFor(stored, world.names);
        const checked = checkExchange({ moves, ...world, ...(basis.trade ? { basis: basis.trade } : {}) });
        if (checked.status === 'blocked') throw new Refused(409, checked.problems.join(' '));

        db.prepare('UPDATE exchange_people SET accepted_at = ? WHERE exchange_id = ? AND person_id = ? AND accepted_at IS NULL').run(now(), fresh.id, session.personId);
        const people = db.prepare('SELECT * FROM exchange_people WHERE exchange_id = ?').all(fresh.id);
        const settled = people.length > 0 && people.every(entry => entry.accepted_at);
        if (settled) {
          // 4. Checked again for the settlement itself. Inside this one transaction nothing can have changed since
          //    step 3, so no test can tell this check from its absence — removing it fails nothing, which is
          //    stated here rather than left for somebody to discover. It is kept because the two checks answer
          //    different questions (may this person agree / may these shifts move) and because a later
          //    restructuring that separates them would otherwise lose the second one silently.
          const finalCheck = checkExchange({ moves, ...tradeWorld(db, dept, { now: now() }), ...(basis.trade ? { basis: basis.trade } : {}) });
          if (finalCheck.status === 'blocked') throw new Refused(409, finalCheck.problems.join(' '));
          db.prepare("UPDATE exchanges SET status = 'Agreed', committed_at = ? WHERE id = ?").run(now(), fresh.id);
          for (const move of stored) db.prepare('UPDATE assignments SET person_id = ?, revision = revision + 1 WHERE id = ?').run(move.toPersonId, move.assignmentId);
        }
        recordReceipt(db, { departmentId: dept, actorId: session.personId, type: settled ? 'Exchange agreed' : 'Exchange acceptance recorded',
          details: { id: fresh.id, by: session.personId, settled, cautions: checked.cautions }, build });
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
    // Chain order, which is seq. Reading them back in any other order and then checking the links would be checking
    // the wrong thing, which is how the ordering bug survived.
    if (first === 'verify') return json(verifyReceipts(db, dept));
    return json(db.prepare('SELECT * FROM receipts WHERE department_id = ? ORDER BY seq').all(dept)
      .map(row => ({ id: row.id, seq: row.seq, type: row.type, actorId: row.actor_id, details: JSON.parse(row.details),
        previousHash: row.previous_hash, hash: row.hash, build: row.build, at: row.at })));
  }

  notFound();
}
