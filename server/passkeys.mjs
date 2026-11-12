// Joining, signing in, adding another passkey, and getting back in after losing a phone.
//
// There is no Department Hub password and no email address typed at sign-in. The phone's own unlock method — face,
// fingerprint or the device passcode — releases a passkey, and the server receives a signed assertion. It never sees
// a face image, a fingerprint template or that passcode; it holds an opaque person ID, credential IDs, public keys
// and sessions.
//
// The shape of joining, which is the part that matters:
//
//   an administrator issues an invitation  ->  the person opens it and registers a passkey  ->  a PENDING CLAIM
//   an administrator confirms who that is, through a channel outside this app  ->  the claim is activated
//
// Holding the link does nothing on its own. Consuming it creates a claim and not a session, the claim expires, and
// until an administrator approves it the membership has no activated_at and therefore grants nothing anywhere in the
// API. The claim shows the joining device a short code; the administrator reads it back over the known channel and
// types it in, which binds the confirmation of a person to that particular credential rather than to a name.
//
// Four kinds of bearer secret, each with its own purpose, expiry and revocation, and none of them interchangeable:
// a session, an invitation, a recovery link and a fresh-verification proof. The last three are single-use. A
// session is not, which is the point of it. Raw secrets are returned in a response body once and never written to a
// receipt.
//
// Local development is supported and proves nothing about production. A passkey registered against localhost says
// nothing about a relying party on a domain the owner controls; choosing that domain is a deployment decision and is
// not made here.
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { Refused } from './api.mjs';
import { liveTokenRow, revokeSessionsFor, revokeSessionsForCredential } from './auth.mjs';
import { newId, now, recordReceipt, secret, sha256, transact } from './db.mjs';
import { departmentHasLiveAdministrator } from './bootstrap.mjs';

const MINUTE = 60 * 1000;
const CHALLENGE_LIFE = 5 * MINUTE;        // long enough to pick up the phone and look at it
const CLAIM_LIFE = 30 * MINUTE;           // long enough for one phone call
const INVITE_LIFE = 48 * 60 * MINUTE;
const VERIFICATION_LIFE = 2 * MINUTE;     // a proof that the person just unlocked their phone, not a standing power
const SESSION_LIFE = 30 * 24 * 60 * MINUTE;

const later = ms => new Date(Date.now() + ms).toISOString();
const bad = message => { throw new Refused(400, message); };
const refused = (status, message) => { throw new Refused(status, message); };

// A six-character code, read aloud over a channel the two people already had. Not a secret and not identity proof:
// it binds a confirmation to one credential claim so that approving "Jordan" cannot approve somebody else's device.
const CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const spokenCode = () => Array.from(secret(12)).filter(character => CODE.includes(character.toUpperCase()))
  .slice(0, 6).map(character => character.toUpperCase()).join('').padEnd(6, '7');

const takeChallenge = (db, id, purpose) => {
  const row = db.prepare('SELECT * FROM challenges WHERE id = ? AND purpose = ?').get(id, purpose);
  if (!row || row.used_at || row.expires_at <= now()) refused(400, 'that challenge is not usable');
  db.prepare('UPDATE challenges SET used_at = ? WHERE id = ?').run(now(), id);
  return row;
};
const putChallenge = (db, { purpose, personId = null, value }) => {
  const id = newId('challenge');
  db.prepare('INSERT INTO challenges (id, purpose, person_id, value, created_at, expires_at) VALUES (?,?,?,?,?,?)')
    .run(id, purpose, personId, value, now(), later(CHALLENGE_LIFE));
  return id;
};

const credentialsOf = (db, personId) => db.prepare('SELECT * FROM credentials WHERE person_id = ? AND revoked_at IS NULL').all(personId);
const activeMembership = (db, personId) =>
  db.prepare('SELECT * FROM memberships WHERE person_id = ? AND revoked_at IS NULL AND activated_at IS NOT NULL').get(personId);

// Proof that this person unlocked their phone within the last couple of minutes. A retained session is not proof:
// adding a credential or approving somebody else's claim needs the person, not just their browser.
function takeFreshVerification(db, session, presented) {
  if (!presented) refused(403, 'this needs a fresh passkey check');
  const row = liveTokenRow(db, presented, 'verification');
  if (!row || row.person_id !== session.personId) refused(403, 'this needs a fresh passkey check');
  db.prepare('UPDATE tokens SET used_at = ? WHERE hash = ?').run(now(), row.hash);
  return row;
}

function mintSession(db, membership, credentialId) {
  const token = secret();
  db.prepare('INSERT INTO tokens (hash, purpose, person_id, department_id, membership_id, credential_id, single_use, created_at, expires_at) VALUES (?,?,?,?,?,?,0,?,?)')
    .run(sha256(token), 'session', membership.person_id, membership.department_id, membership.id, credentialId, now(), later(SESSION_LIFE));
  return { token, expiresAt: later(SESSION_LIFE) };
}

const relyingParty = settings => ({ rpID: settings.rpId, rpName: settings.rpName, origin: settings.rpOrigin });

export async function handlePasskey(db, { segments, method, body = {}, settings, session }) {
  const [area, first, action] = segments;
  const rp = relyingParty(settings);
  const json = value => ({ status: 200, body: value });

  // ---- an administrator issues an invitation or a recovery link ---------------------------------------------------
  if (area === 'invitations') {
    if (method !== 'POST' || first) refused(404, 'not found');
    if (!session) refused(401, 'not signed in');
    if (!session.has('admin')) refused(403, 'not permitted');
    takeFreshVerification(db, session, body.verification);
    const purpose = body.purpose === 'recovery' ? 'recovery' : 'enrollment';
    return transact(db, () => {
      let personId = body.personId ? String(body.personId) : null;
      if (purpose === 'recovery') {
        if (!personId) bad('recovery names the person it is for');
        const membership = db.prepare('SELECT * FROM memberships WHERE person_id = ? AND department_id = ?').get(personId, session.departmentId);
        // Recovery restores a credential. It does not restore a membership that was taken away.
        if (!membership || membership.revoked_at || !membership.activated_at) refused(404, 'not found');
      } else {
        const name = String(body.name ?? '').trim();
        if (!name) bad('an invitation names the person it is for');
        if (!personId) {
          personId = newId('person');
          db.prepare('INSERT INTO people (id, name) VALUES (?,?)').run(personId, name);
        }
        const existing = db.prepare('SELECT * FROM memberships WHERE person_id = ? AND department_id = ?').get(personId, session.departmentId);
        if (existing?.activated_at && !existing.revoked_at) refused(409, 'that person is already a member');
        if (!existing) db.prepare('INSERT INTO memberships (id, person_id, department_id, roles, joined_at) VALUES (?,?,?,?,?)')
          .run(newId('membership'), personId, session.departmentId, JSON.stringify(['member']), now());
      }
      const token = secret();
      db.prepare('INSERT INTO tokens (hash, purpose, person_id, department_id, single_use, created_at, expires_at) VALUES (?,?,?,?,1,?,?)')
        .run(sha256(token), purpose === 'recovery' ? 'recovery' : 'invitation', personId, session.departmentId, now(), later(INVITE_LIFE));
      // The receipt records that an invitation was issued, for whom and by whom. It does not record the token.
      recordReceipt(db, { departmentId: session.departmentId, actorId: session.personId,
        type: purpose === 'recovery' ? 'Recovery link issued' : 'Invitation issued',
        details: { person: personId, by: session.personId, expiresAt: later(INVITE_LIFE) }, build: settings.build });
      return { status: 201, body: { purpose, personId, token, expiresAt: later(INVITE_LIFE),
        note: 'Hand this to the intended person through a channel you already had. Holding it grants no access by itself.' } };
    });
  }

  // ---- the person opens the link, registers a passkey, and waits ---------------------------------------------------
  if (area === 'claims') {
    if (method === 'GET' && !first) {
      if (!session) refused(401, 'not signed in');
      if (!session.has('admin')) refused(403, 'not permitted');
      // The code is deliberately not in this list. It is shown on the joining device and spoken to the administrator.
      return json(db.prepare(`SELECT c.id, c.purpose, c.person_id, c.created_at, c.expires_at, c.credential_id, p.name
        FROM claims c JOIN people p ON p.id = c.person_id
        WHERE c.department_id = ? AND c.approved_at IS NULL AND c.cancelled_at IS NULL AND c.expires_at > ?
        ORDER BY c.created_at`).all(session.departmentId, now())
        .map(row => ({ claimId: row.id, purpose: row.purpose, personId: row.person_id, name: row.name,
          registered: Boolean(row.credential_id), createdAt: row.created_at, expiresAt: row.expires_at })));
    }

    if (method === 'POST' && !first) {
      // Consuming an invitation or a recovery link. This creates a claim, not a session and not access.
      const presented = String(body.token ?? '');
      const invitation = liveTokenRow(db, presented, 'invitation') || liveTokenRow(db, presented, 'recovery')
        || liveTokenRow(db, presented, 'bootstrap');
      if (!invitation) refused(404, 'that link is not usable');
      const person = db.prepare('SELECT * FROM people WHERE id = ?').get(invitation.person_id);
      if (!person) refused(404, 'not found');
      const options = await generateRegistrationOptions({
        rpName: rp.rpName, rpID: rp.rpID, userName: person.name, userID: new Uint8Array(Buffer.from(person.id, 'utf8')),
        attestationType: 'none',
        excludeCredentials: credentialsOf(db, person.id).map(row => ({ id: row.id, ...(row.transports ? { transports: JSON.parse(row.transports) } : {}) })),
        // The device's own unlock method, whichever one it supports. Never a new PIN of this app's invention.
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' }
      });
      return transact(db, () => {
        db.prepare('UPDATE tokens SET used_at = ? WHERE hash = ?').run(now(), invitation.hash);   // single use
        const id = newId('claim'), code = spokenCode();
        db.prepare(`INSERT INTO claims (id, purpose, person_id, department_id, code, challenge, created_at, expires_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(id, invitation.purpose === 'recovery' ? 'recovery' : invitation.purpose === 'bootstrap' ? 'bootstrap' : 'enrollment', person.id,
          invitation.department_id, code, options.challenge, now(), later(CLAIM_LIFE));
        return { status: 201, body: { claimId: id, purpose: invitation.purpose, code, expiresAt: later(CLAIM_LIFE), registration: options,
          note: 'Read this code to your administrator over a number you already had. Nothing is open to you yet.' } };
      });
    }

    const claim = first ? db.prepare('SELECT * FROM claims WHERE id = ?').get(first) : null;
    if (!claim) refused(404, 'not found');

    if (action === 'register' && method === 'POST') {
      if (claim.approved_at || claim.cancelled_at || claim.expires_at <= now()) refused(400, 'that claim is not usable');
      if (claim.credential_id) refused(409, 'a passkey is already registered for this claim');
      let verification;
      try {
        verification = await verifyRegistrationResponse({ response: body.response, expectedChallenge: claim.challenge,
          expectedOrigin: rp.origin, expectedRPID: rp.rpID });
      } catch (error) { refused(400, 'that passkey could not be checked'); }
      if (!verification.verified || !verification.registrationInfo) refused(400, 'that passkey could not be checked');
      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
      return transact(db, () => {
        const fresh = db.prepare('SELECT * FROM claims WHERE id = ?').get(claim.id);
        if (fresh.credential_id) refused(409, 'a passkey is already registered for this claim');
        // The credential waits on the claim. It is not a credential of the person until an administrator approves it.
        db.prepare('UPDATE claims SET credential_id = ?, public_key = ?, transports = ? WHERE id = ?')
          .run(credential.id, Buffer.from(credential.publicKey), JSON.stringify(credential.transports || []), claim.id);
        // The one case with no administrator to confirm it: the first administrator of a department that has none.
        // The condition is checked again here, at the moment it would take effect, and it closes for good.
        if (fresh.purpose === 'bootstrap') {
          if (departmentHasLiveAdministrator(db, fresh.department_id))
            refused(409, 'that department already has an administrator with a passkey');
          db.prepare('INSERT INTO credentials (id, person_id, public_key, counter, transports, created_at) VALUES (?,?,?,0,?,?)')
            .run(credential.id, fresh.person_id, Buffer.from(credential.publicKey), JSON.stringify(credential.transports || []), now());
          db.prepare("UPDATE claims SET approved_at = ?, method = 'bootstrap' WHERE id = ?").run(now(), fresh.id);
          recordReceipt(db, { departmentId: fresh.department_id, actorId: fresh.person_id,
            type: 'First administrator passkey registered', details: { person: fresh.person_id, credentialId: credential.id },
            build: settings.build });
          return { status: 200, body: { claimId: claim.id, registered: true, activated: true, purpose: 'bootstrap',
            deviceType: credentialDeviceType, backedUp: credentialBackedUp,
            status: 'this department had no administrator yet, so this passkey is active; invite the second administrator now' } };
        }
        return { status: 200, body: { claimId: claim.id, code: fresh.code, registered: true,
          deviceType: credentialDeviceType, backedUp: credentialBackedUp,
          status: 'waiting for an administrator to confirm who you are' } };
      });
    }

    if (action === 'approve' && method === 'POST') {
      if (!session) refused(401, 'not signed in');
      if (!session.has('admin')) refused(403, 'not permitted');
      if (claim.department_id !== session.departmentId) refused(404, 'not found');
      // An administrator cannot approve their own claim: that is what the second administrator is for.
      if (claim.person_id === session.personId) refused(403, 'another administrator confirms your own device');
      takeFreshVerification(db, session, body.verification);
      const method_ = String(body.method ?? '').trim();
      if (!['known-number', 'in-person', 'work-channel'].includes(method_))
        bad('say which already-known channel you confirmed through: known-number, in-person or work-channel');
      const spoken = String(body.code ?? '').trim().toUpperCase();
      return transact(db, () => {
        const fresh = db.prepare('SELECT * FROM claims WHERE id = ?').get(claim.id);
        if (fresh.approved_at || fresh.cancelled_at || fresh.expires_at <= now()) refused(400, 'that claim is not usable');
        if (!fresh.credential_id) refused(409, 'that person has not registered a passkey yet');
        if (spoken !== fresh.code) refused(403, 'that code does not match this claim');
        const membership = db.prepare('SELECT * FROM memberships WHERE person_id = ? AND department_id = ?').get(fresh.person_id, fresh.department_id);
        // Re-read at the moment of activation: a membership revoked while the claim waited stays revoked, and a
        // custodian role taken away in the meantime is not handed back by recovery.
        if (!membership || membership.revoked_at) refused(409, 'that person is no longer a member of this department');
        if (fresh.purpose === 'recovery' && !membership.activated_at) refused(409, 'that membership is not active');
        db.prepare('INSERT INTO credentials (id, person_id, public_key, counter, transports, created_at) VALUES (?,?,?,0,?,?)')
          .run(fresh.credential_id, fresh.person_id, fresh.public_key, fresh.transports, now());
        if (fresh.purpose === 'recovery') {
          // One operation: the new credential is live, every older one and its sessions are not, and the person,
          // their history and their contact-sharing choices are untouched.
          for (const old of db.prepare('SELECT * FROM credentials WHERE person_id = ? AND id != ? AND revoked_at IS NULL').all(fresh.person_id, fresh.credential_id)) {
            db.prepare('UPDATE credentials SET revoked_at = ? WHERE id = ?').run(now(), old.id);
            revokeSessionsForCredential(db, old.id);
          }
          db.prepare("UPDATE tokens SET revoked_at = ? WHERE person_id = ? AND purpose = 'session' AND credential_id IS NULL AND revoked_at IS NULL").run(now(), fresh.person_id);
        } else {
          db.prepare('UPDATE memberships SET activated_at = COALESCE(activated_at, ?) WHERE id = ?').run(now(), membership.id);
        }
        db.prepare('UPDATE claims SET approved_at = ?, approved_by = ?, method = ? WHERE id = ?').run(now(), session.personId, method_, claim.id);
        // What the receipt says, and what it does not: who approved, for whom, which credential and which category
        // of channel. Not the number called, not what was said, and not the spoken code.
        recordReceipt(db, { departmentId: fresh.department_id, actorId: session.personId,
          type: fresh.purpose === 'recovery' ? 'Replacement passkey confirmed' : 'Membership activated by passkey confirmation',
          details: { claimId: fresh.id, person: fresh.person_id, credentialId: fresh.credential_id, approvedBy: session.personId, method: method_ },
          build: settings.build });
        return { status: 200, body: { claimId: claim.id, personId: fresh.person_id, purpose: fresh.purpose,
          credentialId: fresh.credential_id, approvedBy: session.personId, method: method_, approvedAt: now(),
          note: 'A recorded confirmation method is not evidence that the human check was performed.' } };
      });
    }

    if (action === 'cancel' && method === 'POST') {
      if (!session) refused(401, 'not signed in');
      if (!session.has('admin') || claim.department_id !== session.departmentId) refused(403, 'not permitted');
      db.prepare('UPDATE claims SET cancelled_at = ? WHERE id = ? AND approved_at IS NULL').run(now(), claim.id);
      return { status: 204, body: null };
    }

    refused(404, 'not found');
  }

  // ---- signing in, proving it again, and adding another passkey ---------------------------------------------------
  if (area === 'passkeys') {
    if (first === 'authentication' && action === 'options' && method === 'POST') {
      const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'preferred' });
      return json({ challengeId: putChallenge(db, { purpose: 'authentication', value: options.challenge }), authentication: options });
    }

    if (first === 'authentication' && !action && method === 'POST') {
      const presented = db.prepare('SELECT * FROM credentials WHERE id = ?').get(String(body.response?.id ?? ''));
      // One answer for an unknown credential, a revoked one and a wrong signature, so a failure says nothing about
      // which it was. The challenge is spent either way.
      const challenge = takeChallenge(db, String(body.challengeId ?? ''), 'authentication');
      if (!presented || presented.revoked_at) refused(401, 'that passkey is not usable');
      let verification;
      try {
        verification = await verifyAuthenticationResponse({ response: body.response, expectedChallenge: challenge.value,
          expectedOrigin: rp.origin, expectedRPID: rp.rpID,
          credential: { id: presented.id, publicKey: new Uint8Array(presented.public_key), counter: presented.counter,
            ...(presented.transports ? { transports: JSON.parse(presented.transports) } : {}) } });
      } catch (error) { refused(401, 'that passkey is not usable'); }
      if (!verification.verified) refused(401, 'that passkey is not usable');
      const membership = activeMembership(db, presented.person_id);
      // A credential can be perfectly valid and still belong to nobody who may come in.
      if (!membership) refused(403, 'that membership is not active');
      return transact(db, () => {
        db.prepare('UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?')
          .run(verification.authenticationInfo.newCounter, now(), presented.id);
        const { token, expiresAt } = mintSession(db, membership, presented.id);
        return json({ token, expiresAt, personId: membership.person_id, departmentId: membership.department_id });
      });
    }

    if (first === 'verification' && action === 'options' && method === 'POST') {
      if (!session) refused(401, 'not signed in');
      const credentials = credentialsOf(db, session.personId);
      if (!credentials.length) refused(409, 'no passkey is registered');
      const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'preferred',
        allowCredentials: credentials.map(row => ({ id: row.id, ...(row.transports ? { transports: JSON.parse(row.transports) } : {}) })) });
      return json({ challengeId: putChallenge(db, { purpose: 'verification', personId: session.personId, value: options.challenge }), authentication: options });
    }

    if (first === 'verification' && !action && method === 'POST') {
      if (!session) refused(401, 'not signed in');
      const challenge = takeChallenge(db, String(body.challengeId ?? ''), 'verification');
      if (challenge.person_id !== session.personId) refused(403, 'that check belongs to somebody else');
      const presented = db.prepare('SELECT * FROM credentials WHERE id = ? AND person_id = ? AND revoked_at IS NULL').get(String(body.response?.id ?? ''), session.personId);
      if (!presented) refused(403, 'that passkey is not yours');
      let verification;
      try {
        verification = await verifyAuthenticationResponse({ response: body.response, expectedChallenge: challenge.value,
          expectedOrigin: rp.origin, expectedRPID: rp.rpID,
          credential: { id: presented.id, publicKey: new Uint8Array(presented.public_key), counter: presented.counter } });
      } catch (error) { refused(403, 'that passkey could not be checked'); }
      if (!verification.verified) refused(403, 'that passkey could not be checked');
      return transact(db, () => {
        db.prepare('UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?').run(verification.authenticationInfo.newCounter, now(), presented.id);
        const token = secret();
        db.prepare('INSERT INTO tokens (hash, purpose, person_id, department_id, membership_id, credential_id, single_use, created_at, expires_at) VALUES (?,?,?,?,?,?,1,?,?)')
          .run(sha256(token), 'verification', session.personId, session.departmentId, session.membershipId, presented.id, now(), later(VERIFICATION_LIFE));
        return json({ verification: token, expiresAt: later(VERIFICATION_LIFE) });
      });
    }

    // Adding another passkey while one still works. A retained session is not enough: the person unlocks an existing
    // credential first, which is what stops a stolen session from quietly enrolling a second device.
    if (first === 'registration' && action === 'options' && method === 'POST') {
      if (!session) refused(401, 'not signed in');
      takeFreshVerification(db, session, body.verification);
      const person = db.prepare('SELECT * FROM people WHERE id = ?').get(session.personId);
      const options = await generateRegistrationOptions({ rpName: rp.rpName, rpID: rp.rpID, userName: person.name,
        userID: new Uint8Array(Buffer.from(person.id, 'utf8')), attestationType: 'none',
        excludeCredentials: credentialsOf(db, session.personId).map(row => ({ id: row.id })),
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' } });
      return json({ challengeId: putChallenge(db, { purpose: 'registration', personId: session.personId, value: options.challenge }), registration: options });
    }

    if (first === 'registration' && !action && method === 'POST') {
      if (!session) refused(401, 'not signed in');
      const challenge = takeChallenge(db, String(body.challengeId ?? ''), 'registration');
      if (challenge.person_id !== session.personId) refused(403, 'that registration belongs to somebody else');
      let verification;
      try {
        verification = await verifyRegistrationResponse({ response: body.response, expectedChallenge: challenge.value,
          expectedOrigin: rp.origin, expectedRPID: rp.rpID });
      } catch (error) { refused(400, 'that passkey could not be checked'); }
      if (!verification.verified || !verification.registrationInfo) refused(400, 'that passkey could not be checked');
      const { credential } = verification.registrationInfo;
      return transact(db, () => {
        if (db.prepare('SELECT 1 FROM credentials WHERE id = ?').get(credential.id)) refused(409, 'that passkey is already registered');
        db.prepare('INSERT INTO credentials (id, person_id, public_key, counter, transports, created_at) VALUES (?,?,?,0,?,?)')
          .run(credential.id, session.personId, Buffer.from(credential.publicKey), JSON.stringify(credential.transports || []), now());
        recordReceipt(db, { departmentId: session.departmentId, actorId: session.personId, type: 'Passkey added',
          details: { credentialId: credential.id, person: session.personId }, build: settings.build });
        return { status: 201, body: { credentialId: credential.id, personId: session.personId, addedAt: now() } };
      });
    }

    // What the person can see of their own passkeys, and of anything done to them.
    if (!first && method === 'GET') {
      if (!session) refused(401, 'not signed in');
      const credentials = db.prepare('SELECT * FROM credentials WHERE person_id = ? ORDER BY created_at').all(session.personId);
      const events = db.prepare(`SELECT c.id, c.purpose, c.approved_at, c.approved_by, c.method, c.credential_id, p.name AS approved_by_name
        FROM claims c LEFT JOIN people p ON p.id = c.approved_by WHERE c.person_id = ? AND c.approved_at IS NOT NULL ORDER BY c.approved_at`).all(session.personId);
      return json({
        personId: session.personId,
        passkeys: credentials.map(row => ({ credentialId: row.id, addedAt: row.created_at, lastUsedAt: row.last_used_at, revokedAt: row.revoked_at })),
        confirmations: events.map(row => ({ claimId: row.id, purpose: row.purpose, credentialId: row.credential_id,
          approvedAt: row.approved_at, approvedBy: row.approved_by, approvedByName: row.approved_by_name, method: row.method }))
      });
    }

    refused(404, 'not found');
  }

  refused(404, 'not found');
}
