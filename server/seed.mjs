// A repeatable synthetic fixture for the shared permission gate.
//
//   node server/seed.mjs --db ./local-data/shared.sqlite --out ./local-data/shared-fixture.json --base-url http://127.0.0.1:18080
//
// Everything it writes is invented. The names are not anybody's, the numbers are reserved 555-01xx numbers that do
// not ring, and the schedule is a few days of made-up shifts. It never reads the owner's workspace, his imported
// telephone list or any real schedule, and it refuses to run against a database that holds records it did not make.
//
// It empties every table first, because the contract suite creates and deletes a control post, records an
// acceptance, changes contact sharing, removes a role and revokes a membership. A second run against a used
// fixture would be testing the leftovers.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { newId, now, open, secret, sha256, transact } from './db.mjs';

const TABLES = ['exchange_people', 'exchanges', 'messages', 'conversation_people', 'conversations', 'files', 'documents', 'posts',
  'assignments', 'fairness', 'receipts', 'challenges', 'claims', 'credentials', 'tokens', 'profiles', 'memberships', 'people', 'departments'];

const PEOPLE = [
  { key: 'member', id: 'test-arden', name: 'Arden', roles: ['member'], phone: '3175550101', share: true },
  { key: 'partner', id: 'test-bexley', name: 'Bexley', roles: ['member'], phone: '3175550102', share: false },
  { key: 'outsider', id: 'test-cypress', name: 'Cypress', roles: ['member'], phone: '3175550103', share: null },
  { key: 'keeper', id: 'test-devon', name: 'Devon', roles: ['member', 'custodian'], phone: null, share: false },
  { key: 'admin', id: 'test-ellis', name: 'Ellis', roles: ['admin', 'member'], phone: null, share: false },
  { key: 'revocable', id: 'test-glenna', name: 'Glenna', roles: ['member'], phone: null, share: false },
  { key: 'foreign', id: 'test-foster', name: 'Foster', roles: ['member'], phone: null, share: false, department: 'b' }
];

export function seed({ dbPath, baseUrl, runId = 'test-' + Date.now().toString(36) + '-' + secret(4).toLowerCase().replace(/[^a-z0-9]/g, '') }) {
  const db = open(dbPath);
  const existing = db.prepare('SELECT COUNT(*) AS n FROM people WHERE id NOT LIKE ?').get('test-%').n;
  if (existing) throw new Error('Refusing to seed: this database holds ' + existing + ' records the seeder did not create. Use a separate file.');
  const mark = suffix => runId + '-' + suffix;
  const at = now();
  const departments = { a: 'test-elm', b: 'test-oak' };
  const sessions = {}, records = {};

  transact(db, () => {
    db.exec('PRAGMA foreign_keys = OFF');
    for (const table of TABLES) db.prepare('DELETE FROM ' + table).run();
    db.exec('PRAGMA foreign_keys = ON');

    db.prepare('INSERT INTO departments (id, name) VALUES (?,?)').run(departments.a, 'Elm Respiratory (synthetic)');
    db.prepare('INSERT INTO departments (id, name) VALUES (?,?)').run(departments.b, 'Oak Respiratory (synthetic)');

    const membershipOf = {};
    for (const person of PEOPLE) {
      const dept = departments[person.department || 'a'];
      db.prepare('INSERT INTO people (id, name) VALUES (?,?)').run(person.id, person.name);
      const membershipId = 'test-m-' + person.key;
      db.prepare('INSERT INTO memberships (id, person_id, department_id, roles, joined_at, activated_at) VALUES (?,?,?,?,?,?)')
        .run(membershipId, person.id, dept, JSON.stringify([...person.roles].sort()), at, at);
      membershipOf[person.key] = membershipId;
      // sharing off by default: the outsider's row is inserted with no sharing flag chosen at all.
      db.prepare('INSERT INTO profiles (person_id, phone, share_phone) VALUES (?,?,?)')
        .run(person.id, person.phone, person.share === true ? 1 : 0);
      sessions[person.key] = { personId: person.id, membershipId, departmentId: dept };
    }

    const mint = (key, person, membershipId, departmentId) => {
      const token = secret();
      db.prepare('INSERT INTO tokens (hash, purpose, person_id, department_id, membership_id, single_use, created_at, expires_at) VALUES (?,?,?,?,?,0,?,?)')
        .run(sha256(token), 'session', person, departmentId, membershipId, at, new Date(Date.now() + 86400000).toISOString());
      sessions[key] = { personId: person, membershipId, departmentId, headers: { Authorization: 'Bearer ' + token } };
    };
    for (const person of PEOPLE) mint(person.key, person.id, membershipOf[person.key], departments[person.department || 'a']);
    // The revocable person has two independent live sessions, so revocation has to end both.
    mint('revocableSecond', 'test-glenna', membershipOf.revocable, departments.a);

    const post = (id, dept, author, body) => { db.prepare('INSERT INTO posts (id, department_id, author_id, body, created_at) VALUES (?,?,?,?,?)').run(id, dept, author, body, at); return id; };
    const document = (id, dept, title, body) => { db.prepare('INSERT INTO documents (id, department_id, title, kind, effective, body, added_at) VALUES (?,?,?,?,?,?,?)').run(id, dept, title, 'Policy', '2026-01-01', body, at); return id; };
    const file = (id, dept, name, body, conversation = null) =>
      { db.prepare('INSERT INTO files (id, department_id, conversation_id, name, content_type, bytes, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, dept, conversation, name, 'text/plain; charset=utf-8', Buffer.from(body, 'utf8'), at); return id; };

    records.post = { id: post('test-post-a', departments.a, 'test-arden', 'fixture-signal new filters are in the supply room. ' + mark('public-post')), marker: mark('public-post') };
    records.document = { id: document('test-doc-a', departments.a, 'Leave requests (synthetic)', 'Purpose\n\nfixture-signal a request for leave is entered four weeks before the schedule is posted. ' + mark('public-document')), marker: mark('public-document') };
    records.file = { id: file('test-file-a', departments.a, 'department-note.txt', 'fixture-signal ' + mark('file-bytes')), marker: mark('file-bytes') };
    records.foreignPost = { id: post('test-post-b', departments.b, 'test-foster', 'fixture-signal the other department’s board. ' + mark('foreign-post')), marker: mark('foreign-post') };
    records.foreignDocument = { id: document('test-doc-b', departments.b, 'Oak leave policy (synthetic)', 'fixture-signal the other department’s document. ' + mark('foreign-document')), marker: mark('foreign-document') };
    records.foreignFile = { id: file('test-file-b', departments.b, 'oak-note.txt', 'fixture-signal ' + mark('foreign-file-bytes')), marker: mark('foreign-file-bytes') };

    // A private trade conversation: the two people in the trade, and nobody else. The administrator is not in it.
    const thread = 'test-thread-a';
    db.prepare('INSERT INTO conversations (id, department_id, subject, created_at) VALUES (?,?,?,?)').run(thread, departments.a, 'Trade: Fri, Nov 13 night', at);
    for (const person of ['test-arden', 'test-bexley']) db.prepare('INSERT INTO conversation_people (conversation_id, person_id) VALUES (?,?)').run(thread, person);
    db.prepare('INSERT INTO messages (id, conversation_id, author_id, body, created_at) VALUES (?,?,?,?,?)')
      .run('test-message-a', thread, 'test-arden', 'fixture-signal can you take this one? ' + mark('private-conversation'), at);
    records.conversation = { id: thread, marker: mark('private-conversation') };
    records.privateFile = { id: file('test-private-file-a', departments.a, 'trade-note.txt', 'fixture-signal ' + mark('private-file-bytes'), thread), marker: mark('private-file-bytes') };

    // A few invented shifts. The schedule gives the Ask engine its names and makes the exchange a real move.
    const shifts = [
      ['2026-11-12', 'D', 'test-arden'], ['2026-11-12', 'N', 'test-bexley'],
      ['2026-11-13', 'N', 'test-arden'], ['2026-11-13', 'D', 'test-cypress'],
      ['2026-11-14', 'N', 'test-bexley'], ['2026-11-14', 'D', 'test-devon'],
      ['2026-11-15', 'D', 'test-ellis'], ['2026-11-15', 'N', 'test-glenna'],
      ['2026-11-16', 'D', 'test-arden'], ['2026-11-16', 'N', 'test-cypress']
    ];
    const assignmentIds = {};
    for (const [date, shift, person] of shifts) {
      const id = 'test-shift-' + date.replaceAll('-', '') + '-' + shift;
      db.prepare('INSERT INTO assignments (id, department_id, date, shift, person_id, revision) VALUES (?,?,?,?,?,1)').run(id, departments.a, date, shift, person);
      assignmentIds[date + shift] = id;
    }
    db.prepare('INSERT INTO assignments (id, department_id, date, shift, person_id, revision) VALUES (?,?,?,?,?,1)')
      .run('test-shift-oak', departments.b, '2026-11-13', 'D', 'test-foster');

    // A pending exchange between the two people in the thread, checked against the roster revision it was built on.
    const exchange = 'test-exchange-a';
    const moves = [{ assignmentId: assignmentIds['2026-11-13N'], fromPersonId: 'test-arden', toPersonId: 'test-bexley', date: '2026-11-13', shift: 'N' }];
    db.prepare('INSERT INTO exchanges (id, department_id, conversation_id, moves, basis, status, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(exchange, departments.a, thread, JSON.stringify(moves), JSON.stringify({ rosterRevision: 1, rulesRevision: 'pilot-3', proposedBy: 'test-arden' }), 'Waiting', at);
    for (const person of ['test-arden', 'test-bexley']) db.prepare('INSERT INTO exchange_people (exchange_id, person_id) VALUES (?,?)').run(exchange, person);
    records.conversation.exchangeId = exchange;

    // Named fairness totals. fixture-signal is in the note so the search filter has something real to withhold.
    const fairness = [['test-arden', 0], ['test-bexley', 1], ['test-cypress', 2], ['test-devon', 1], ['test-ellis', 0], ['test-glenna', 1]];
    for (const [person, weekends] of fairness)
      db.prepare('INSERT INTO fairness (person_id, department_id, weekend_turns, holiday_turns, note) VALUES (?,?,?,?,?)')
        .run(person, departments.a, weekends, 0, 'fixture-signal named fairness record ' + mark('fairness-' + person));
    db.prepare('INSERT INTO fairness (person_id, department_id, weekend_turns, holiday_turns, note) VALUES (?,?,?,?,?)')
      .run('test-foster', departments.b, 3, 1, 'fixture-signal ' + mark('foreign-fairness'));
  });

  const fixture = {
    version: 1, synthetic: true, runId, baseUrl,
    sessions, records,
    fairness: { memberWeekendTurns: 0, partnerWeekendTurns: 1 },
    contacts: {
      shared: { personId: 'test-arden', name: 'Arden', phone: '3175550101' },
      private: { personId: 'test-bexley', name: 'Bexley', phone: '3175550102' },
      defaultPrivate: { personId: 'test-cypress', name: 'Cypress', phone: '3175550103' },
      newPrivate: { personId: 'test-devon', name: 'Devon', phone: '3175550104' }
    }
  };
  db.close();
  return fixture;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const argv = process.argv.slice(2);
  const flag = name => { const at = argv.indexOf('--' + name); return at >= 0 ? argv[at + 1] : null; };
  const dbPath = flag('db') || process.env.DEPARTMENT_HUB_DB || './local-data/shared.sqlite';
  const out = flag('out') || './local-data/shared-fixture.json';
  const baseUrl = flag('base-url') || 'http://127.0.0.1:' + (process.env.DEPARTMENT_HUB_PORT || 18080);
  const fixture = seed({ dbPath, baseUrl, ...(flag('run-id') ? { runId: flag('run-id') } : {}) });
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), JSON.stringify(fixture, null, 2) + '\n');
  console.log('Seeded synthetic fixture ' + fixture.runId + ' into ' + dbPath);
  console.log('Manifest with live test sessions: ' + resolve(out) + ' (keep it out of Git; local-data/ is ignored)');
}
