// The records one caller is allowed to see, in the shape the existing Ask engine already reads.
//
// This is the point of the whole arrangement: the permission decisions happen while the world is being built, so the
// engine that produces text never holds a record the asker may not see. Nothing is filtered out of the answer
// afterwards, because nothing that should be hidden was ever in the engine's hands.
import { normalizeName } from '../src/model.js';
import { phoneFor } from './visibility.mjs';

const text = row => {
  if (!row?.bytes) return '';
  const type = row.content_type || '';
  if (!/^text\/|json|csv/.test(type)) return '';
  return Buffer.from(row.bytes).toString('utf8');
};

export function visibleRecords(db, session) {
  const dept = session.departmentId;
  const people = db.prepare(`SELECT p.id, p.name, pr.phone, pr.share_phone
    FROM memberships m JOIN people p ON p.id = m.person_id LEFT JOIN profiles pr ON pr.person_id = p.id
    WHERE m.department_id = ? AND m.revoked_at IS NULL ORDER BY p.name`).all(dept)
    .map(row => ({ ...row, person_id: row.id }));
  const posts = db.prepare('SELECT * FROM posts WHERE department_id = ? AND deleted_at IS NULL ORDER BY created_at').all(dept);
  const documents = db.prepare('SELECT * FROM documents WHERE department_id = ? ORDER BY added_at').all(dept);
  const assignments = db.prepare('SELECT * FROM assignments WHERE department_id = ? ORDER BY date, shift').all(dept);
  // Only the conversations this person is in. Membership administration is not participation.
  const conversations = db.prepare(`SELECT c.* FROM conversations c JOIN conversation_people cp ON cp.conversation_id = c.id
    WHERE c.department_id = ? AND cp.person_id = ?`).all(dept, session.personId);
  const mine = new Set(conversations.map(row => row.id));
  const files = db.prepare('SELECT * FROM files WHERE department_id = ?').all(dept)
    .filter(row => !row.conversation_id || mine.has(row.conversation_id));
  // A named fairness total is the person's own or the custodian's to read, and nobody else's.
  const fairness = db.prepare('SELECT f.*, p.name FROM fairness f JOIN people p ON p.id = f.person_id WHERE f.department_id = ?').all(dept)
    .filter(row => row.person_id === session.personId || session.has('custodian'));
  return { people, posts, documents, assignments, conversations, files, fairness, mine };
}

// The Ask engine's world. Names come from the schedule, as they do in the local build, and a phone number is present
// only when its owner has shared it with this caller.
export function askWorld(db, session, { today = new Date().toISOString().slice(0, 10), seen = null } = {}) {
  const records = visibleRecords(db, session);
  const byId = new Map(records.people.map(row => [row.id, row]));
  const me = byId.get(session.personId);
  const directory = {}, links = {};
  for (const row of records.people) {
    directory[normalizeName(row.name)] = { person: row.name, status: 'Staff', skills: ['D', 'N'] };
    links[normalizeName(row.name)] = row.id;
  }
  const messages = Object.fromEntries(records.conversations.map(row =>
    [row.id, db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at').all(row.id)]));
  return {
    world: {
      today, now: new Date().toISOString(), actor: me?.name || '',
      assignments: records.assignments.map(row => ({ date: row.date, shift: row.shift, person: byId.get(row.person_id)?.name || row.person_id, role: row.role || undefined, hours: row.hours || undefined })),
      posts: records.posts.map(row => ({ id: row.id, author: byId.get(row.author_id)?.name || row.author_id, body: row.body, created: row.created_at })),
      documents: records.documents.map(row => ({ id: row.id, title: row.title, kind: row.kind, effective: row.effective, text: row.body, added: row.added_at, by: byId.get(row.author_id)?.name || '' })),
      directory, links,
      people: records.people.map(row => ({ id: row.id, first: row.name, last: '', cell: phoneFor(session, row) || '' })),
      releases: [], requests: [], rules: {}, answers: [], learned: [], corrections: [], versions: {},
      keeper: session.has('custodian'), seen, published: null
    },
    links, records, byId, messages
  };
}

// Which stored record each answer item came from, in the source kinds the permission contract fixes.
export function sourcesFor(found, { links, personId }) {
  const sources = [], seen = new Set();
  const add = (kind, id) => { if (!id) return; const key = kind + '|' + id; if (!seen.has(key)) { seen.add(key); sources.push({ kind, id }); } };
  if (found.kind === 'contact') for (const name of found.context?.others || []) add('person', links[normalizeName(name)]);
  if (found.kind === 'fair') add('fairness', links[normalizeName((found.context?.others || [])[0] || '')] || personId);
  for (const item of found.items || []) {
    const [prefix, first] = String(item.go || '').split('|');
    if (prefix === 'post') add('post', first);
    else if (prefix === 'doc') add('document', first);
    else if (prefix === 'date' || prefix === 'options') add('schedule', first || item.text);
    else if (prefix === 'people') for (const name of found.context?.others || []) add('person', links[normalizeName(name)]);
    else if (prefix === 'fairness') add('fairness', personId);
  }
  return sources;
}

// Search over the same permitted records. A term has to appear in the stored content, and the record has to be one
// this caller could have opened directly.
export function search(db, session, query) {
  const terms = String(query || '').toLowerCase().split(/[^a-z0-9'’-]+/i).filter(word => word.length > 1);
  if (!terms.length) return [];
  const records = visibleRecords(db, session);
  const byId = new Map(records.people.map(row => [row.id, row]));
  const matches = body => { const low = String(body || '').toLowerCase(); return terms.every(term => low.includes(term)); };
  const clip = body => { const flat = String(body).replace(/\s+/g, ' ').trim(); return flat.length > 400 ? flat.slice(0, 400) : flat; };
  const found = [];
  for (const row of records.posts) if (matches(row.body)) found.push({ kind: 'post', id: row.id, title: 'Board post', snippet: clip(row.body), by: byId.get(row.author_id)?.name || null });
  for (const row of records.documents) if (matches(row.title + ' ' + row.body)) found.push({ kind: 'document', id: row.id, title: row.title, snippet: clip(row.body) });
  for (const row of records.files) { const body = Buffer.from(row.bytes).toString('utf8');
    if (matches(row.name + ' ' + (/^text\/|json|csv/.test(row.content_type || '') ? body : ''))) found.push({ kind: 'file', id: row.id, title: row.name, snippet: clip(body) }); }
  for (const row of records.conversations) {
    const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at').all(row.id);
    const body = [row.subject, ...messages.map(message => message.body)].join(' ');
    if (matches(body)) found.push({ kind: 'conversation', id: row.id, title: row.subject, snippet: clip(body) });
  }
  for (const row of records.fairness) if (matches(row.name + ' ' + row.note)) found.push({ kind: 'fairness', id: row.person_id, title: row.name, snippet: clip(row.note), weekendTurns: row.weekend_turns });
  for (const row of records.people) if (matches(row.name)) found.push({ kind: 'person', id: row.id, title: row.name, phone: phoneFor(session, row) });
  return found;
}
