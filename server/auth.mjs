// Who is asking, decided by the server alone.
//
// A request carries a bearer token and nothing else that counts. The person, their department and their roles are
// read from the database on every request, so removing a role or revoking a membership takes effect on the next
// request without waiting for a token to expire. Anything a client says about who it is — a body field, a query
// parameter, an X-Actor header — is ignored here and everywhere that calls this.
import { now, sha256 } from './db.mjs';

const BEARER = /^Bearer\s+(\S+)$/i;
const COOKIE = /(?:^|;\s*)department_hub_session=([^;]+)/;

export function presentedToken(headers) {
  const authorization = headers.authorization || '';
  const bearer = BEARER.exec(authorization);
  if (bearer) return bearer[1];
  const cookie = COOKIE.exec(headers.cookie || '');
  return cookie ? decodeURIComponent(cookie[1]) : null;
}

export const liveTokenRow = (db, token, purpose) => {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM tokens WHERE hash = ? AND purpose = ?').get(sha256(token), purpose);
  if (!row || row.revoked_at) return null;
  if (row.expires_at && row.expires_at <= now()) return null;
  if (row.single_use && row.used_at) return null;
  return row;
};

// The caller, or null. A session whose membership has been revoked is not a caller at all, which is why
// /api/session itself fails immediately after revocation rather than reporting a member with no access.
export function resolveSession(db, headers) {
  const row = liveTokenRow(db, presentedToken(headers), 'session');
  if (!row) return null;
  const membership = db.prepare('SELECT * FROM memberships WHERE id = ?').get(row.membership_id);
  // Revoked, or invited but never confirmed: either way there is no caller here.
  if (!membership || membership.revoked_at || !membership.activated_at) return null;
  if (membership.person_id !== row.person_id || membership.department_id !== row.department_id) return null;
  let roles = [];
  try { roles = JSON.parse(membership.roles); } catch { roles = []; }
  return {
    tokenHash: row.hash,
    personId: membership.person_id,
    departmentId: membership.department_id,
    membershipId: membership.id,
    roles,
    has: role => roles.includes(role)
  };
}

export const revokeSessionsFor = (db, membershipId) =>
  db.prepare("UPDATE tokens SET revoked_at = ? WHERE membership_id = ? AND purpose = 'session' AND revoked_at IS NULL").run(now(), membershipId);

export const revokeSessionsForCredential = (db, credentialId) =>
  db.prepare("UPDATE tokens SET revoked_at = ? WHERE credential_id = ? AND purpose = 'session' AND revoked_at IS NULL").run(now(), credentialId);
