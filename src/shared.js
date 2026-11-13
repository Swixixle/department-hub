// Signing in to the department server, joining it from an invitation, and the administrator's two jobs: inviting a
// coworker and confirming who they are.
//
// The app only offers any of this when it is opened from the department server itself (the page and /api share one
// address, which passkeys require). Opened from serve.py or the public demo there is no server, and the app stays the
// one-browser app it has always been.
//
// What this keeps on the phone: one session token, in this browser's storage, and nothing else. No password exists.
// The phone's own unlock (face, fingerprint or passcode) releases the passkey; the server receives a signature.
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';

const SESSION_KEY = 'department-hub-shared-session';

export class SharedError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// fetch and the two passkey ceremonies are passed in, so the flow can be exercised without a phone.
export function sharedClient({ base = '', fetch: send = (...args) => globalThis.fetch(...args), passkeys = { startAuthentication, startRegistration },
  storage = globalThis.localStorage } = {}) {
  const read = () => { try { return JSON.parse(storage?.getItem(SESSION_KEY) || 'null'); } catch { return null; } };
  const write = value => { try { value ? storage.setItem(SESSION_KEY, JSON.stringify(value)) : storage.removeItem(SESSION_KEY); } catch { /* private window */ } };
  let session = read();

  async function call(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && session?.token) headers.Authorization = 'Bearer ' + session.token;
    const response = await send(base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    let value = null;
    try { value = text ? JSON.parse(text) : null; } catch { value = null; }
    if (!response.ok) {
      // A session the server no longer honours (revoked, removed from the department) is forgotten here at once.
      if (response.status === 401 && auth && session) { session = null; write(null); }
      throw new SharedError(response.status, value?.error || 'the server answered ' + response.status);
    }
    return value;
  }

  // Who is signed in, re-read from the server: roles and membership come from there, never from this phone's copy.
  async function refresh() {
    if (!session?.token) return null;
    try {
      const me = await call('/api/session');
      const people = await call('/api/departments/' + encodeURIComponent(me.departmentId) + '/directory').catch(() => []);
      const self = (people || []).find(person => (person.personId || person.id) === me.personId);
      session = { ...session, ...me, name: self?.name || session.name || 'Member' };
      write(session);
      return session;
    } catch (error) {
      if (error.status === 401 || error.status === 403) { session = null; write(null); return null; }
      throw error;
    }
  }

  // A fresh unlock of this person's own passkey, which the server asks for before inviting or confirming anyone.
  async function freshCheck() {
    const { challengeId, authentication } = await call('/api/passkeys/verification/options', { method: 'POST', body: {} });
    const response = await passkeys.startAuthentication({ optionsJSON: authentication });
    return (await call('/api/passkeys/verification', { method: 'POST', body: { challengeId, response } })).verification;
  }

  return {
    get session() { return session; },
    supported: () => { try { return browserSupportsWebAuthn(); } catch { return false; } },

    // Is this page being served by the department server? A plain file server answers /api/health with 404.
    async available() {
      try { const value = await call('/api/health', { auth: false }); return value?.ok === true; } catch { return false; }
    },

    refresh,

    async signIn() {
      const { challengeId, authentication } = await call('/api/passkeys/authentication/options', { method: 'POST', body: {}, auth: false });
      const response = await passkeys.startAuthentication({ optionsJSON: authentication });
      const signed = await call('/api/passkeys/authentication', { method: 'POST', body: { challengeId, response }, auth: false });
      session = { token: signed.token, expiresAt: signed.expiresAt, personId: signed.personId, departmentId: signed.departmentId };
      write(session);
      return refresh();
    },

    signOut() { session = null; write(null); },

    // Joining: the invitation becomes a claim, the phone makes a passkey for it, and the person reads the code to an
    // administrator. Nothing opens until the administrator confirms. A first-administrator link activates at once.
    async join(token) {
      const claim = await call('/api/claims', { method: 'POST', body: { token: String(token || '').trim() }, auth: false });
      const response = await passkeys.startRegistration({ optionsJSON: claim.registration });
      const registered = await call('/api/claims/' + encodeURIComponent(claim.claimId) + '/register', { method: 'POST', body: { response }, auth: false });
      return { claimId: claim.claimId, code: claim.code, activated: Boolean(registered.activated), expiresAt: claim.expiresAt };
    },

    async invite(name) {
      const verification = await freshCheck();
      const made = await call('/api/invitations', { method: 'POST', body: { name: String(name || '').trim(), verification } });
      return { ...made, link: joinLink(made.token) };
    },

    async waiting() { return (await call('/api/claims')) || []; },

    async approve(claimId, code, method) {
      const verification = await freshCheck();
      return call('/api/claims/' + encodeURIComponent(claimId) + '/approve', { method: 'POST', body: { code: String(code || '').trim().toUpperCase(), method, verification } });
    },

    // Removing someone ends their sessions on the server at once; their phone is told on its next request.
    async remove(membershipId) {
      return call('/api/departments/' + encodeURIComponent(session.departmentId) + '/memberships/' + encodeURIComponent(membershipId), { method: 'DELETE' });
    },
    async setRoles(membershipId, roles) {
      return call('/api/departments/' + encodeURIComponent(session.departmentId) + '/memberships/' + encodeURIComponent(membershipId), { method: 'PATCH', body: { roles } });
    },

    async directory() {
      if (!session?.departmentId) return [];
      return (await call('/api/departments/' + encodeURIComponent(session.departmentId) + '/directory')) || [];
    }
  };
}

// The link a coworker opens. The token rides after the #, so it is never sent to the server in a page request or kept
// in its logs; the page reads it and hands it over once.
export function joinLink(token, origin = globalThis.location?.origin || '') {
  return origin + '/#join=' + encodeURIComponent(token);
}
export function joinTokenFrom(hash = globalThis.location?.hash || '') {
  const match = /(?:^#|&)join=([^&]+)/.exec(hash);
  return match ? decodeURIComponent(match[1]) : null;
}
