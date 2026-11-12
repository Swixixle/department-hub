// The first administrator of a department, created on the machine rather than over the network.
//
//   node server/bootstrap.mjs --db ./local-data/hub.sqlite --department elm --department-name "Elm Respiratory" --name "Alex"
//
// Somebody has to be first, and the first administrator cannot be confirmed by an administrator who does not exist
// yet. So this is a command the owner runs on the computer holding the database, not an HTTP route: it cannot be
// reached remotely at all. It creates the person, an active administrator membership, and one single-use link that
// registers that person's first passkey.
//
// It refuses to run a second time once the department has an administrator with a usable passkey, and the server
// refuses to activate a bootstrap claim under the same condition, checked again at the moment of registration. From
// then on every enrollment and every recovery goes through an administrator's confirmation. The second administrator
// is invited the ordinary way, and the brief's requirement of two capable administrators before a real pilot is a
// thing the owner does, not something this command establishes.
import { newId, now, open, recordReceipt, secret, sha256, transact } from './db.mjs';

export const departmentHasLiveAdministrator = (db, departmentId) => Boolean(db.prepare(`
  SELECT 1 FROM memberships m JOIN credentials c ON c.person_id = m.person_id
  WHERE m.department_id = ? AND m.revoked_at IS NULL AND m.activated_at IS NOT NULL
    AND c.revoked_at IS NULL AND m.roles LIKE '%"admin"%' LIMIT 1`).get(departmentId));

export function bootstrapAdministrator(db, { departmentId, departmentName, name, life = 60 * 60 * 1000 }) {
  if (!departmentId || !name) throw new Error('a department and a name are needed');
  if (departmentHasLiveAdministrator(db, departmentId))
    throw new Error('that department already has an administrator with a passkey; invite the next one from inside the app');
  return transact(db, () => {
    if (!db.prepare('SELECT 1 FROM departments WHERE id = ?').get(departmentId))
      db.prepare('INSERT INTO departments (id, name) VALUES (?,?)').run(departmentId, departmentName || departmentId);
    const personId = newId('person');
    db.prepare('INSERT INTO people (id, name) VALUES (?,?)').run(personId, name);
    db.prepare('INSERT INTO memberships (id, person_id, department_id, roles, joined_at, activated_at) VALUES (?,?,?,?,?,?)')
      .run(newId('membership'), personId, departmentId, JSON.stringify(['admin', 'member']), now(), now());
    const token = secret();
    const expiresAt = new Date(Date.now() + life).toISOString();
    db.prepare('INSERT INTO tokens (hash, purpose, person_id, department_id, single_use, created_at, expires_at) VALUES (?,?,?,?,1,?,?)')
      .run(sha256(token), 'bootstrap', personId, departmentId, now(), expiresAt);
    recordReceipt(db, { departmentId, actorId: personId, type: 'First administrator created on the machine',
      details: { person: personId, name }, build: 'bootstrap' });
    return { personId, departmentId, token, expiresAt };
  });
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const argv = process.argv.slice(2);
  const flag = name => { const at = argv.indexOf('--' + name); return at >= 0 ? argv[at + 1] : null; };
  const dbPath = flag('db') || process.env.DEPARTMENT_HUB_DB || './local-data/hub.sqlite';
  const db = open(dbPath);
  const made = bootstrapAdministrator(db, { departmentId: flag('department'), departmentName: flag('department-name'), name: flag('name') });
  db.close();
  console.log('Administrator ' + made.personId + ' created in department ' + made.departmentId + '.');
  console.log('One-time passkey registration token (expires ' + made.expiresAt + '):');
  console.log('  ' + made.token);
  console.log('Open the app on the phone that will hold this passkey and give it that token. It works once.');
  console.log('Then invite the second administrator from inside the app: nobody should be the only one who can recover a coworker.');
}
