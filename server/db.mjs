// The shared department's records, kept in one SQLite file.
//
// node:sqlite is built into Node 22.5+, so the server adds no runtime dependency to a repository that has only Vite
// and Tesseract. It gives real files, real transactions and real constraints, which is what the permission contract
// needs: a denied write has to leave nothing behind, and a trade has to commit or not at all.
//
// Identity is never taken from a request body. A session row names the person, the department and the membership, and
// every request reads the membership and its roles again, so a revoked member or a removed role stops working on the
// next request without waiting for anything to expire.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- One row per person per department. roles is a sorted JSON array: member, custodian, admin.
-- revoked_at is the only thing that ends a membership; nothing is deleted, so a receipt still resolves.
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  department_id TEXT NOT NULL REFERENCES departments(id),
  roles TEXT NOT NULL DEFAULT '["member"]',
  joined_at TEXT NOT NULL,
  -- A membership invited but not yet confirmed has no activated_at and grants nothing at all.
  activated_at TEXT,
  revoked_at TEXT,
  UNIQUE (person_id, department_id)
);

-- Bearer secrets. Only the hash is stored, so the file cannot hand anyone a working token.
-- purpose keeps a session token, an invitation and a recovery link from being usable in each other's place.
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  person_id TEXT REFERENCES people(id),
  department_id TEXT REFERENCES departments(id),
  membership_id TEXT REFERENCES memberships(id),
  credential_id TEXT,
  claim TEXT,
  single_use INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS tokens_person ON tokens (person_id, purpose);

CREATE TABLE IF NOT EXISTS profiles (
  person_id TEXT PRIMARY KEY REFERENCES people(id),
  phone TEXT,
  share_phone INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  author_id TEXT NOT NULL REFERENCES people(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS posts_department ON posts (department_id, created_at);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'Policy',
  effective TEXT,
  body TEXT NOT NULL,
  added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_people (
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  PRIMARY KEY (conversation_id, person_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  author_id TEXT NOT NULL REFERENCES people(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_conversation ON messages (conversation_id, created_at);

-- An attachment. conversation_id set means only that conversation's participants may download the bytes.
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  conversation_id TEXT REFERENCES conversations(id),
  name TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL
);

-- A proposed exchange. basis is the roster and rule revision it was checked against, so a stale proposal is
-- recognisable at the moment of final agreement rather than committed on old facts.
CREATE TABLE IF NOT EXISTS exchanges (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  conversation_id TEXT REFERENCES conversations(id),
  moves TEXT NOT NULL,
  basis TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Waiting',
  created_at TEXT NOT NULL,
  committed_at TEXT
);

CREATE TABLE IF NOT EXISTS exchange_people (
  exchange_id TEXT NOT NULL REFERENCES exchanges(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  accepted_at TEXT,
  PRIMARY KEY (exchange_id, person_id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  date TEXT NOT NULL,
  shift TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id),
  role TEXT,
  hours TEXT,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS assignments_department ON assignments (department_id, date);

-- Named fairness totals. note is searchable text; the permission check decides whether it is ever returned.
CREATE TABLE IF NOT EXISTS fairness (
  person_id TEXT NOT NULL REFERENCES people(id),
  department_id TEXT NOT NULL REFERENCES departments(id),
  weekend_turns INTEGER NOT NULL DEFAULT 0,
  holiday_turns INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (person_id, department_id)
);

-- Hash-linked receipts for state changes, as in the local app. Raw secrets never go in here.
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  actor_id TEXT,
  type TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  previous_hash TEXT,
  hash TEXT NOT NULL,
  build TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS receipts_department ON receipts (department_id, at);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS credentials_person ON credentials (person_id);

-- A pending enrollment or recovery claim: created by consuming an invitation, activated only by an administrator
-- who confirmed the person through a channel outside this app.
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id),
  department_id TEXT NOT NULL REFERENCES departments(id),
  code TEXT NOT NULL,
  challenge TEXT,
  credential_id TEXT,
  public_key BLOB,
  transports TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  approved_by TEXT REFERENCES people(id),
  method TEXT,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS claims_person ON claims (person_id, purpose);

-- Short-lived WebAuthn challenges, kept server-side so a replayed assertion cannot be accepted twice.
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  person_id TEXT,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
`;

export const now = () => new Date().toISOString();
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const secret = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const newId = prefix => prefix + '-' + randomBytes(8).toString('hex');

export function open(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

// One transaction, committed or rolled back as a unit. A handler that throws changes nothing.
export function transact(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = work(); db.exec('COMMIT'); return value; }
  catch (error) { try { db.exec('ROLLBACK'); } catch { /* the failure above is the one that matters */ } throw error; }
}

// Receipts chain within a department, as they do in the local workspace.
export function recordReceipt(db, { departmentId, actorId, type, details = {}, build = null }) {
  const previous = db.prepare('SELECT hash FROM receipts WHERE department_id = ? ORDER BY at DESC, id DESC LIMIT 1').get(departmentId);
  const at = now(), id = newId('receipt');
  const body = JSON.stringify({ id, departmentId, actorId, type, details, previousHash: previous?.hash ?? null, at, build });
  const hash = sha256(body);
  db.prepare('INSERT INTO receipts (id, department_id, actor_id, type, details, previous_hash, hash, build, at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, departmentId, actorId, type, JSON.stringify(details), previous?.hash ?? null, hash, build, at);
  return { id, hash, at };
}
