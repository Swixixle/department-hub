// Enrollment, sign-in, adding a second passkey and lost-phone recovery, over real HTTP against the real server with
// real P-256 signatures. The authenticator is software (tests/server/authenticator.mjs); the verification is the
// actual @simplewebauthn/server code.
//
// What these do not establish, and no test here can: that any of it works on a phone. There is no Face ID,
// fingerprint reader, device passcode, platform authenticator or browser in this file, and the relying party is
// localhost. A recorded confirmation method is also not evidence that a human made the phone call.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, route } from './harness.mjs';
import { authenticator } from './authenticator.mjs';
import { bootstrapAdministrator } from '../../server/bootstrap.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { open } from '../../server/db.mjs';

let h, dept;
const phones = {};
const held = {};

// Enrol the department's first administrator the way the owner would: a command on the machine, then one link.
async function bootstrapAdmin() {
  const db = open(h.dbPath);
  const made = bootstrapAdministrator(db, { departmentId: 'test-bootstrap-dept', departmentName: 'Bootstrap (synthetic)', name: 'Admin One' });
  db.close();
  phones.adminOne = authenticator({ rpId: h.settings.rpId, origin: h.settings.rpOrigin });
  const claim = await h.request(null, '/api/claims', { method: 'POST', body: { token: made.token } });
  assert.equal(claim.status, 201);
  assert.equal(claim.json.purpose, 'bootstrap');
  const registered = await h.request(null, '/api/claims/' + claim.json.claimId + '/register',
    { method: 'POST', body: { response: phones.adminOne.register(claim.json.registration, { credentialId: 'admin-one-phone' }) } });
  assert.equal(registered.status, 200);
  assert.equal(registered.json.activated, true);
  return { ...made, department: 'test-bootstrap-dept' };
}

async function signIn(phone, credentialId) {
  const options = await h.request(null, '/api/passkeys/authentication/options', { method: 'POST', body: {} });
  assert.equal(options.status, 200);
  const result = await h.request(null, '/api/passkeys/authentication',
    { method: 'POST', body: { challengeId: options.json.challengeId, response: phone.authenticate(options.json.authentication, { credentialId }) } });
  return result;
}
const asSession = result => ({ headers: { Authorization: 'Bearer ' + result.json.token } });

async function freshCheck(session, phone, credentialId) {
  const options = await h.request(session, '/api/passkeys/verification/options', { method: 'POST', body: {} });
  assert.equal(options.status, 200);
  const done = await h.request(session, '/api/passkeys/verification',
    { method: 'POST', body: { challengeId: options.json.challengeId, response: phone.authenticate(options.json.authentication, { credentialId }) } });
  assert.equal(done.status, 200, 'a fresh check needs an existing passkey');
  return done.json.verification;
}

before(async () => {
  h = await boot();
  const made = await bootstrapAdmin();
  dept = made.department;
  held.adminOne = { personId: made.personId };
  const signedIn = await signIn(phones.adminOne, 'admin-one-phone');
  assert.equal(signedIn.status, 200);
  held.adminOne.session = asSession(signedIn);
  held.adminOne.token = signedIn.json.token;
});
after(() => h?.stop());

describe('the first administrator, then the second', { concurrency: false }, () => {
  test('the bootstrap passkey signs in and the department is theirs', async () => {
    const who = await h.request(held.adminOne.session, '/api/session');
    assert.equal(who.status, 200);
    assert.equal(who.json.personId, held.adminOne.personId);
    assert.deepEqual(who.json.roles.sort(), ['admin', 'member']);
    assert.equal(who.json.departmentId, dept);
  });

  test('the bootstrap route closes once that administrator has a passkey', async () => {
    const db = open(h.dbPath);
    assert.throws(() => bootstrapAdministrator(db, { departmentId: dept, name: 'Sneaky Second' }), /already has an administrator/);
    db.close();
  });

  test('a second administrator is invited through the app, confirmed by the first', async () => {
    const verification = await freshCheck(held.adminOne.session, phones.adminOne, 'admin-one-phone');
    const invited = await h.request(held.adminOne.session, '/api/invitations', { method: 'POST', body: { purpose: 'enrollment', name: 'Admin Two', verification } });
    assert.equal(invited.status, 201);
    phones.adminTwo = authenticator({ rpId: h.settings.rpId, origin: h.settings.rpOrigin });
    const claim = await h.request(null, '/api/claims', { method: 'POST', body: { token: invited.json.token } });
    assert.equal(claim.status, 201);
    await h.request(null, '/api/claims/' + claim.json.claimId + '/register',
      { method: 'POST', body: { response: phones.adminTwo.register(claim.json.registration, { credentialId: 'admin-two-phone' }) } });
    const approval = await h.request(held.adminOne.session, '/api/claims/' + claim.json.claimId + '/approve',
      { method: 'POST', body: { code: claim.json.code, method: 'known-number', verification: await freshCheck(held.adminOne.session, phones.adminOne, 'admin-one-phone') } });
    assert.equal(approval.status, 200);
    const signedIn = await signIn(phones.adminTwo, 'admin-two-phone');
    assert.equal(signedIn.status, 200);
    held.adminTwo = { personId: invited.json.personId, session: asSession(signedIn) };
    // Invited as a member. Being invited by an administrator does not make a person one.
    assert.deepEqual((await h.request(held.adminTwo.session, '/api/session')).json.roles, ['member']);
    const promoted = await h.request(held.adminOne.session, route(dept, 'memberships', (await h.request(held.adminTwo.session, '/api/session')).json.membershipId),
      { method: 'PATCH', body: { roles: ['admin', 'member'] } });
    assert.equal(promoted.status, 200);
    assert.deepEqual((await h.request(held.adminTwo.session, '/api/session')).json.roles.sort(), ['admin', 'member']);
  });
});

describe('a member joins', { concurrency: false }, () => {
  let claim, invited;
  test('holding the link opens nothing', async () => {
    const verification = await freshCheck(held.adminOne.session, phones.adminOne, 'admin-one-phone');
    invited = await h.request(held.adminOne.session, '/api/invitations', { method: 'POST', body: { purpose: 'enrollment', name: 'Rowan', verification } });
    assert.equal(invited.status, 201);
    phones.rowan = authenticator({ rpId: h.settings.rpId, origin: h.settings.rpOrigin });
    const consumed = await h.request(null, '/api/claims', { method: 'POST', body: { token: invited.json.token } });
    assert.equal(consumed.status, 201);
    claim = consumed.json;
    assert.equal(consumed.json.token, undefined, 'consuming a link does not hand back a session');
    // Nothing in the response is a credential for the department, and the person is not in it yet.
    assert.equal((await h.request(held.adminOne.session, route(dept, 'directory'))).text.includes(invited.json.personId), false);
  });

  test('the same link cannot be used twice', async () => {
    const again = await h.request(null, '/api/claims', { method: 'POST', body: { token: invited.json.token } });
    assert.equal(again.status, 404);
  });

  test('a registered passkey still grants nothing until an administrator confirms it', async () => {
    const registered = await h.request(null, '/api/claims/' + claim.claimId + '/register',
      { method: 'POST', body: { response: phones.rowan.register(claim.registration, { credentialId: 'rowan-phone' }) } });
    assert.equal(registered.status, 200);
    assert.equal(registered.json.activated, undefined);
    assert.match(registered.json.status, /waiting for an administrator/);
    // The credential is on the claim, not among the person's credentials, so the answer is the same 401 an
    // unknown passkey gets. A failure does not say which of the two it was.
    const tried = await signIn(phones.rowan, 'rowan-phone');
    assert.equal(tried.status, 401, 'a confirmed-by-nobody credential is not a way in');
    assert.equal((await h.request(held.adminOne.session, route(dept, 'directory'))).text.includes(invited.json.personId), false);
  });

  test('the waiting list an administrator sees does not contain the spoken code', async () => {
    const waiting = await h.request(held.adminOne.session, '/api/claims');
    assert.equal(waiting.status, 200);
    const mine = waiting.json.find(row => row.claimId === claim.claimId);
    assert.ok(mine, 'the claim is waiting');
    assert.equal(mine.registered, true);
    assert.equal(waiting.text.includes(claim.code), false, 'the code is read aloud, not listed');
  });

  test('approval needs an administrator, a fresh passkey check, and the right code', async () => {
    const path = '/api/claims/' + claim.claimId + '/approve';
    // Not an administrator at all.
    const outsider = await signIn(phones.adminTwo, 'admin-two-phone');
    assert.equal((await h.request(null, path, { method: 'POST', body: { code: claim.code, method: 'known-number' } })).status, 401);
    // An administrator, but no fresh check: a retained session is not the person.
    assert.equal((await h.request(held.adminOne.session, path, { method: 'POST', body: { code: claim.code, method: 'known-number' } })).status, 403);
    // A session token is not a verification token, however fresh the session is.
    assert.equal((await h.request(held.adminOne.session, path, { method: 'POST', body: { code: claim.code, method: 'known-number', verification: held.adminOne.token } })).status, 403);
    // A fresh check, but the code read back was wrong: the confirmation is of a person, bound to one claim.
    const wrongCode = await h.request(held.adminOne.session, path,
      { method: 'POST', body: { code: 'ZZZZZZ', method: 'known-number', verification: await freshCheck(held.adminOne.session, phones.adminOne, 'admin-one-phone') } });
    assert.equal(wrongCode.status, 403);
    // A fresh check and the right code, but no channel named.
    const noMethod = await h.request(held.adminOne.session, path,
      { method: 'POST', body: { code: claim.code, verification: await freshCheck(held.adminOne.session, phones.adminOne, 'admin-one-phone') } });
    assert.equal(noMethod.status, 400);
    assert.equal((await signIn(phones.rowan, 'rowan-phone')).status, 401, 'none of those attempts let anybody in');
    // And now properly, by the other administrator, remotely, on their own.
    const approved = await h.request(held.adminTwo.session, path,
      { method: 'POST', body: { code: claim.code, method: 'known-number', verification: await freshCheck(asSession(outsider), phones.adminTwo, 'admin-two-phone') } });
    assert.equal(approved.status, 200);
    assert.equal(approved.json.approvedBy, held.adminTwo.personId);
    assert.match(approved.json.note, /not evidence that the human check was performed/);
    const signedIn = await signIn(phones.rowan, 'rowan-phone');
    assert.equal(signedIn.status, 200);
    held.rowan = { personId: invited.json.personId, session: asSession(signedIn), token: signedIn.json.token };
    assert.equal((await h.request(held.rowan.session, route(dept, 'directory'))).status, 200);
  });

  test('an approved claim cannot be approved again', async () => {
    const again = await h.request(held.adminOne.session, '/api/claims/' + claim.claimId + '/approve',
      { method: 'POST', body: { code: claim.code, method: 'known-number', verification: await freshCheck(held.adminOne.session, phones.adminOne, 'admin-one-phone') } });
    assert.equal(again.status, 400);
  });

  test('an administrator cannot confirm their own device', async () => {
    const verification = await freshCheck(held.adminOne.session, phones.adminOne, 'admin-one-phone');
    const invite = await h.request(held.adminOne.session, '/api/invitations',
      { method: 'POST', body: { purpose: 'recovery', personId: held.adminOne.personId, verification } });
    assert.equal(invite.status, 201);
    const own = await h.request(null, '/api/claims', { method: 'POST', body: { token: invite.json.token } });
    const spare = authenticator({ rpId: h.settings.rpId, origin: h.settings.rpOrigin });
    await h.request(null, '/api/claims/' + own.json.claimId + '/register',
      { method: 'POST', body: { response: spare.register(own.json.registration, { credentialId: 'admin-one-self-approval' }) } });
    const refused = await h.request(held.adminOne.session, '/api/claims/' + own.json.claimId + '/approve',
      { method: 'POST', body: { code: own.json.code, method: 'known-number', verification: await freshCheck(held.adminOne.session, phones.adminOne, 'admin-one-phone') } });
    assert.equal(refused.status, 403);
    // The other administrator can, which is the whole reason there are two.
    const byOther = await h.request(held.adminTwo.session, '/api/claims/' + own.json.claimId + '/approve',
      { method: 'POST', body: { code: own.json.code, method: 'known-number', verification: await freshCheck(held.adminTwo.session, phones.adminTwo, 'admin-two-phone') } });
    assert.equal(byOther.status, 200);
    phones.adminOne = spare;
    const signedIn = await signIn(spare, 'admin-one-self-approval');
    assert.equal(signedIn.status, 200);
    held.adminOne.session = asSession(signedIn);
    held.adminOne.token = signedIn.json.token;
    held.adminOne.credentialId = 'admin-one-self-approval';
  });
});

describe('signing in, and failing to', { concurrency: false }, () => {
  test('a wrong signature, a cancelled prompt and an unknown credential all fail the same way', async () => {
    const options = await h.request(null, '/api/passkeys/authentication/options', { method: 'POST', body: {} });
    const corrupt = await h.request(null, '/api/passkeys/authentication',
      { method: 'POST', body: { challengeId: options.json.challengeId, response: phones.rowan.authenticate(options.json.authentication, { credentialId: 'rowan-phone', corrupt: true }) } });
    assert.equal(corrupt.status, 401);
    const second = await h.request(null, '/api/passkeys/authentication/options', { method: 'POST', body: {} });
    const cancelled = await h.request(null, '/api/passkeys/authentication', { method: 'POST', body: { challengeId: second.json.challengeId } });
    assert.ok([400, 401].includes(cancelled.status));
    const third = await h.request(null, '/api/passkeys/authentication/options', { method: 'POST', body: {} });
    const stranger = authenticator({ rpId: h.settings.rpId, origin: h.settings.rpOrigin });
    const made = stranger.register({ challenge: third.json.authentication.challenge }, { credentialId: 'never-enrolled' });
    void made;
    const unknown = await h.request(null, '/api/passkeys/authentication',
      { method: 'POST', body: { challengeId: third.json.challengeId, response: stranger.authenticate(third.json.authentication, { credentialId: 'never-enrolled' }) } });
    assert.equal(unknown.status, 401);
  });

  test('a challenge is spent once, so a captured response cannot be replayed', async () => {
    const options = await h.request(null, '/api/passkeys/authentication/options', { method: 'POST', body: {} });
    const response = phones.rowan.authenticate(options.json.authentication, { credentialId: 'rowan-phone' });
    const first = await h.request(null, '/api/passkeys/authentication', { method: 'POST', body: { challengeId: options.json.challengeId, response } });
    assert.equal(first.status, 200);
    const replay = await h.request(null, '/api/passkeys/authentication', { method: 'POST', body: { challengeId: options.json.challengeId, response } });
    assert.equal(replay.status, 400, 'the challenge is gone, so the same message cannot be sent again');
  });

  test('a challenge from one person cannot be answered by another', async () => {
    const options = await h.request(held.rowan.session, '/api/passkeys/verification/options', { method: 'POST', body: {} });
    const answered = await h.request(held.adminOne.session, '/api/passkeys/verification',
      { method: 'POST', body: { challengeId: options.json.challengeId, response: phones.adminOne.authenticate(options.json.authentication, { credentialId: held.adminOne.credentialId }) } });
    assert.equal(answered.status, 403);
  });
});

describe('a second passkey, and the bearer secrets', { concurrency: false }, () => {
  test('adding another passkey needs a fresh check with one that already works', async () => {
    const withoutCheck = await h.request(held.rowan.session, '/api/passkeys/registration/options', { method: 'POST', body: {} });
    assert.equal(withoutCheck.status, 403);
    const withSessionToken = await h.request(held.rowan.session, '/api/passkeys/registration/options', { method: 'POST', body: { verification: held.rowan.token } });
    assert.equal(withSessionToken.status, 403, 'a session token is not a fresh check');
    const verification = await freshCheck(held.rowan.session, phones.rowan, 'rowan-phone');
    const options = await h.request(held.rowan.session, '/api/passkeys/registration/options', { method: 'POST', body: { verification } });
    assert.equal(options.status, 200);
    const tablet = authenticator({ rpId: h.settings.rpId, origin: h.settings.rpOrigin });
    const added = await h.request(held.rowan.session, '/api/passkeys/registration',
      { method: 'POST', body: { challengeId: options.json.challengeId, response: tablet.register(options.json.registration, { credentialId: 'rowan-tablet' }) } });
    assert.equal(added.status, 201);
    phones.rowanTablet = tablet;
    assert.equal((await signIn(tablet, 'rowan-tablet')).status, 200, 'both passkeys work');
    assert.equal((await signIn(phones.rowan, 'rowan-phone')).status, 200);
  });

  test('a fresh check is spent by the thing it authorised', async () => {
    const verification = await freshCheck(held.rowan.session, phones.rowan, 'rowan-phone');
    assert.equal((await h.request(held.rowan.session, '/api/passkeys/registration/options', { method: 'POST', body: { verification } })).status, 200);
    assert.equal((await h.request(held.rowan.session, '/api/passkeys/registration/options', { method: 'POST', body: { verification } })).status, 403);
  });

  test('each kind of token works only for its own purpose', async () => {
    const verification = await freshCheck(held.adminOne.session, phones.adminOne, held.adminOne.credentialId);
    const invited = await h.request(held.adminOne.session, '/api/invitations', { method: 'POST', body: { purpose: 'enrollment', name: 'Unused Invite', verification } });
    const invitation = invited.json.token;
    // An invitation is not a session.
    assert.equal((await h.request({ headers: { Authorization: 'Bearer ' + invitation } }, '/api/session')).status, 401);
    assert.equal((await h.request({ headers: { Authorization: 'Bearer ' + invitation } }, route(dept, 'posts'))).status, 401);
    // A session is not an invitation.
    assert.equal((await h.request(null, '/api/claims', { method: 'POST', body: { token: held.adminOne.token } })).status, 404);
    // A fresh check is not a session either.
    const proof = await freshCheck(held.adminOne.session, phones.adminOne, held.adminOne.credentialId);
    assert.equal((await h.request({ headers: { Authorization: 'Bearer ' + proof } }, '/api/session')).status, 401);
    assert.equal((await h.request(null, '/api/claims', { method: 'POST', body: { token: proof } })).status, 404);
  });

  test('no raw token reaches a receipt', async () => {
    const receipts = await h.request(held.adminOne.session, route(dept, 'receipts'));
    assert.equal(receipts.status, 200);
    assert.ok(receipts.json.some(row => row.type === 'Invitation issued'));
    assert.ok(receipts.json.some(row => /passkey/i.test(row.type)));
    // Every kind of bearer secret, not just the session ones: an invitation, a recovery link and a fresh check.
    const verification = await freshCheck(held.adminOne.session, phones.adminOne, held.adminOne.credentialId);
    const invitation = await h.request(held.adminOne.session, '/api/invitations', { method: 'POST', body: { purpose: 'enrollment', name: 'Receipt Check', verification } });
    const recovery = await h.request(held.adminOne.session, '/api/invitations',
      { method: 'POST', body: { purpose: 'recovery', personId: held.rowan.personId, verification: await freshCheck(held.adminOne.session, phones.adminOne, held.adminOne.credentialId) } });
    const spent = await freshCheck(held.adminOne.session, phones.adminOne, held.adminOne.credentialId);
    const after = await h.request(held.adminOne.session, route(dept, 'receipts'));
    for (const token of [held.adminOne.token, held.rowan.token, invitation.json.token, recovery.json.token, spent, verification])
      assert.equal(after.text.includes(token), false, 'a raw bearer secret reached a receipt');
    for (const row of after.json) assert.equal(JSON.stringify(row).includes('"code"'), false, 'a spoken code reached a receipt');
  });
});

describe('a lost phone', { concurrency: false }, () => {
  let replacement;
  test('recovery is issued by an administrator, not requested by a text message', async () => {
    // "New phone, it's me" is not an authorisation: there is no route for the member to reset themselves. Not even
    // with a fresh passkey check of their own, which is the part worth being explicit about — proving you are you
    // is not the same as being allowed to reset somebody's credentials, including your own.
    const theirOwnCheck = await freshCheck(held.rowan.session, phones.rowan, 'rowan-phone');
    assert.equal((await h.request(held.rowan.session, '/api/invitations', { method: 'POST', body: { purpose: 'recovery', personId: held.rowan.personId, verification: theirOwnCheck } })).status, 403);
    assert.equal((await h.request(held.rowan.session, '/api/invitations', { method: 'POST', body: { purpose: 'enrollment', name: 'Invited By A Member', verification: await freshCheck(held.rowan.session, phones.rowan, 'rowan-phone') } })).status, 403);
    assert.equal((await h.request(held.rowan.session, '/api/invitations', { method: 'POST', body: { purpose: 'recovery', personId: held.rowan.personId } })).status, 403);
    const verification = await freshCheck(held.adminOne.session, phones.adminOne, held.adminOne.credentialId);
    const issued = await h.request(held.adminOne.session, '/api/invitations',
      { method: 'POST', body: { purpose: 'recovery', personId: held.rowan.personId, verification } });
    assert.equal(issued.status, 201);
    replacement = { token: issued.json.token, phone: authenticator({ rpId: h.settings.rpId, origin: h.settings.rpOrigin }) };
  });

  test('the replacement passkey waits for the same confirmation as a first enrollment', async () => {
    const claim = await h.request(null, '/api/claims', { method: 'POST', body: { token: replacement.token } });
    assert.equal(claim.status, 201);
    assert.equal(claim.json.purpose, 'recovery');
    await h.request(null, '/api/claims/' + claim.json.claimId + '/register',
      { method: 'POST', body: { response: replacement.phone.register(claim.json.registration, { credentialId: 'rowan-new-phone' }) } });
    assert.equal((await signIn(replacement.phone, 'rowan-new-phone')).status, 401, 'not until it is confirmed');
    const approved = await h.request(held.adminTwo.session, '/api/claims/' + claim.json.claimId + '/approve',
      { method: 'POST', body: { code: claim.json.code, method: 'known-number', verification: await freshCheck(held.adminTwo.session, phones.adminTwo, 'admin-two-phone') } });
    assert.equal(approved.status, 200);
    replacement.claimId = claim.json.claimId;
  });

  test('the old passkeys and their sessions are dead, and the new one works', async () => {
    assert.equal((await h.request(held.rowan.session, '/api/session')).status, 401, 'the session on the lost phone stops working');
    assert.equal((await signIn(phones.rowan, 'rowan-phone')).status, 401, 'so does the credential on it');
    assert.equal((await signIn(phones.rowanTablet, 'rowan-tablet')).status, 401, 'and the other one, because which was lost is not known');
    const signedIn = await signIn(replacement.phone, 'rowan-new-phone');
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.json.personId, held.rowan.personId, 'the same person, not a new one');
    held.rowan.session = asSession(signedIn);
  });

  test('recovery keeps the person, their history and their contact choices', async () => {
    const profile = await h.request(held.rowan.session, route(dept, 'profile'));
    assert.equal(profile.json.personId, held.rowan.personId);
    assert.equal(profile.json.sharePhone, false, 'sharing stays off, as it started');
    const confirmations = await h.request(held.rowan.session, '/api/passkeys');
    assert.equal(confirmations.status, 200);
    // The affected member can see what was done to their account and who did it.
    const recovery = confirmations.json.confirmations.find(row => row.purpose === 'recovery');
    assert.ok(recovery, 'the recovery is visible to the person it happened to');
    assert.equal(recovery.approvedBy, held.adminTwo.personId);
    assert.equal(recovery.method, 'known-number');
    assert.equal(confirmations.json.passkeys.filter(row => !row.revokedAt).length, 1);
    assert.equal(confirmations.json.passkeys.filter(row => row.revokedAt).length, 2);
  });

  test('recovery does not restore a membership that was taken away', async () => {
    const membershipId = (await h.request(held.rowan.session, '/api/session')).json.membershipId;
    assert.ok([200, 204].includes((await h.request(held.adminOne.session, route(dept, 'memberships', membershipId), { method: 'DELETE' })).status));
    assert.equal((await h.request(held.rowan.session, '/api/session')).status, 401);
    const verification = await freshCheck(held.adminOne.session, phones.adminOne, held.adminOne.credentialId);
    const issued = await h.request(held.adminOne.session, '/api/invitations',
      { method: 'POST', body: { purpose: 'recovery', personId: held.rowan.personId, verification } });
    assert.equal(issued.status, 404, 'there is nobody to recover');
    assert.equal((await signIn(replacement.phone, 'rowan-new-phone')).status, 403, 'the credential is fine; the membership is gone');
  });

  test('a claim approved after the person lost a role does not hand it back', async () => {
    // Give a new member the custodian role, start a recovery, take the role away while the claim waits.
    const verification = await freshCheck(held.adminOne.session, phones.adminOne, held.adminOne.credentialId);
    const invited = await h.request(held.adminOne.session, '/api/invitations', { method: 'POST', body: { purpose: 'enrollment', name: 'Marlow', verification } });
    const phone = authenticator({ rpId: h.settings.rpId, origin: h.settings.rpOrigin });
    const claim = await h.request(null, '/api/claims', { method: 'POST', body: { token: invited.json.token } });
    await h.request(null, '/api/claims/' + claim.json.claimId + '/register',
      { method: 'POST', body: { response: phone.register(claim.json.registration, { credentialId: 'marlow-phone' }) } });
    await h.request(held.adminTwo.session, '/api/claims/' + claim.json.claimId + '/approve',
      { method: 'POST', body: { code: claim.json.code, method: 'known-number', verification: await freshCheck(held.adminTwo.session, phones.adminTwo, 'admin-two-phone') } });
    const first = await signIn(phone, 'marlow-phone');
    const membershipId = first.json && (await h.request(asSession(first), '/api/session')).json.membershipId;
    await h.request(held.adminOne.session, route(dept, 'memberships', membershipId), { method: 'PATCH', body: { roles: ['member', 'custodian'] } });
    assert.ok((await h.request(asSession(first), '/api/session')).json.roles.includes('custodian'));

    const recoveryVerification = await freshCheck(held.adminOne.session, phones.adminOne, held.adminOne.credentialId);
    const recovery = await h.request(held.adminOne.session, '/api/invitations',
      { method: 'POST', body: { purpose: 'recovery', personId: invited.json.personId, verification: recoveryVerification } });
    const recoveryClaim = await h.request(null, '/api/claims', { method: 'POST', body: { token: recovery.json.token } });
    const newPhone = authenticator({ rpId: h.settings.rpId, origin: h.settings.rpOrigin });
    await h.request(null, '/api/claims/' + recoveryClaim.json.claimId + '/register',
      { method: 'POST', body: { response: newPhone.register(recoveryClaim.json.registration, { credentialId: 'marlow-new-phone' }) } });
    // The role is removed while the claim is waiting.
    await h.request(held.adminOne.session, route(dept, 'memberships', membershipId), { method: 'PATCH', body: { roles: ['member'] } });
    const approved = await h.request(held.adminTwo.session, '/api/claims/' + recoveryClaim.json.claimId + '/approve',
      { method: 'POST', body: { code: recoveryClaim.json.code, method: 'known-number', verification: await freshCheck(held.adminTwo.session, phones.adminTwo, 'admin-two-phone') } });
    assert.equal(approved.status, 200);
    const after = await signIn(newPhone, 'marlow-new-phone');
    assert.equal(after.status, 200);
    assert.deepEqual((await h.request(asSession(after), '/api/session')).json.roles, ['member'], 'recovery restored the passkey, not the role');
  });
});

describe('everything short-lived actually expires', { concurrency: false }, () => {
  // Expiry is checked by moving the stored expires_at into the past, which is the condition the server reads. No
  // test here waits out a real two-day invitation.
  const expire = (table, id) => { const db = open(h.dbPath); db.prepare('UPDATE ' + table + " SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(id); db.close(); };
  const expireToken = token => { const db = open(h.dbPath); db.prepare("UPDATE tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE hash = ?").run(createHash('sha256').update(token).digest('hex')); db.close(); };

  test('an expired invitation cannot be consumed', async () => {
    const verification = await freshCheck(held.adminOne.session, phones.adminOne, held.adminOne.credentialId);
    const invited = await h.request(held.adminOne.session, '/api/invitations', { method: 'POST', body: { purpose: 'enrollment', name: 'Expired Invite', verification } });
    expireToken(invited.json.token);
    assert.equal((await h.request(null, '/api/claims', { method: 'POST', body: { token: invited.json.token } })).status, 404);
  });

  test('an expired claim cannot be registered against or approved', async () => {
    const verification = await freshCheck(held.adminOne.session, phones.adminOne, held.adminOne.credentialId);
    const invited = await h.request(held.adminOne.session, '/api/invitations', { method: 'POST', body: { purpose: 'enrollment', name: 'Slow Joiner', verification } });
    const claim = await h.request(null, '/api/claims', { method: 'POST', body: { token: invited.json.token } });
    const phone = authenticator({ rpId: h.settings.rpId, origin: h.settings.rpOrigin });
    const response = phone.register(claim.json.registration, { credentialId: 'slow-joiner-phone' });
    expire('claims', claim.json.claimId);
    assert.equal((await h.request(null, '/api/claims/' + claim.json.claimId + '/register', { method: 'POST', body: { response } })).status, 400);
    assert.equal((await h.request(held.adminTwo.session, '/api/claims/' + claim.json.claimId + '/approve',
      { method: 'POST', body: { code: claim.json.code, method: 'known-number', verification: await freshCheck(held.adminTwo.session, phones.adminTwo, 'admin-two-phone') } })).status, 400);
    assert.equal((await signIn(phone, 'slow-joiner-phone')).status, 401);
  });

  test('an expired fresh check is no longer fresh', async () => {
    const verification = await freshCheck(held.adminOne.session, phones.adminOne, held.adminOne.credentialId);
    expireToken(verification);
    assert.equal((await h.request(held.adminOne.session, '/api/invitations', { method: 'POST', body: { purpose: 'enrollment', name: 'Nobody', verification } })).status, 403);
  });

  test('an expired challenge cannot be answered', async () => {
    const options = await h.request(null, '/api/passkeys/authentication/options', { method: 'POST', body: {} });
    const response = phones.adminOne.authenticate(options.json.authentication, { credentialId: held.adminOne.credentialId });
    expire('challenges', options.json.challengeId);
    assert.equal((await h.request(null, '/api/passkeys/authentication', { method: 'POST', body: { challengeId: options.json.challengeId, response } })).status, 400);
  });

  test('an expired session stops working without anybody revoking it', async () => {
    const signedIn = await signIn(phones.adminTwo, 'admin-two-phone');
    assert.equal(signedIn.status, 200);
    const session = asSession(signedIn);
    assert.equal((await h.request(session, '/api/session')).status, 200);
    expireToken(signedIn.json.token);
    assert.equal((await h.request(session, '/api/session')).status, 401);
  });
});

describe('states that should not be reachable are refused anyway', { concurrency: false }, () => {
  // These three construct, in the database, a state the normal flows do not produce, and require the server to
  // refuse it at the point it would take effect. They are the guards behind the guards.

  test('a credential belonging to a membership that was never activated is not a way in', async () => {
    const verification = await freshCheck(held.adminOne.session, phones.adminOne, held.adminOne.credentialId);
    const invited = await h.request(held.adminOne.session, '/api/invitations', { method: 'POST', body: { purpose: 'enrollment', name: 'Never Confirmed', verification } });
    const claim = await h.request(null, '/api/claims', { method: 'POST', body: { token: invited.json.token } });
    const phone = authenticator({ rpId: h.settings.rpId, origin: h.settings.rpOrigin });
    await h.request(null, '/api/claims/' + claim.json.claimId + '/register',
      { method: 'POST', body: { response: phone.register(claim.json.registration, { credentialId: 'never-confirmed-phone' }) } });
    // Move the credential off the claim and onto the person, leaving the membership pending.
    const db = open(h.dbPath);
    const waiting = db.prepare('SELECT * FROM claims WHERE id = ?').get(claim.json.claimId);
    db.prepare('INSERT INTO credentials (id, person_id, public_key, counter, created_at) VALUES (?,?,?,0,?)')
      .run(waiting.credential_id, waiting.person_id, waiting.public_key, new Date().toISOString());
    const membership = db.prepare('SELECT * FROM memberships WHERE person_id = ?').get(waiting.person_id);
    assert.equal(membership.activated_at, null, 'the membership is still pending, which is the point');
    db.close();
    const tried = await signIn(phone, 'never-confirmed-phone');
    assert.equal(tried.status, 403, 'the passkey checks out; the membership was never confirmed');
  });

  test('a recovery claim approved after the membership was revoked does not bring it back', async () => {
    const verification = await freshCheck(held.adminOne.session, phones.adminOne, held.adminOne.credentialId);
    const invited = await h.request(held.adminOne.session, '/api/invitations', { method: 'POST', body: { purpose: 'enrollment', name: 'Briefly Here', verification } });
    const phone = authenticator({ rpId: h.settings.rpId, origin: h.settings.rpOrigin });
    const claim = await h.request(null, '/api/claims', { method: 'POST', body: { token: invited.json.token } });
    await h.request(null, '/api/claims/' + claim.json.claimId + '/register',
      { method: 'POST', body: { response: phone.register(claim.json.registration, { credentialId: 'briefly-here-phone' }) } });
    await h.request(held.adminTwo.session, '/api/claims/' + claim.json.claimId + '/approve',
      { method: 'POST', body: { code: claim.json.code, method: 'known-number', verification: await freshCheck(held.adminTwo.session, phones.adminTwo, 'admin-two-phone') } });
    const signedIn = await signIn(phone, 'briefly-here-phone');
    assert.equal(signedIn.status, 200);
    const membershipId = (await h.request(asSession(signedIn), '/api/session')).json.membershipId;

    // A recovery is started while they are still a member, and finished after they are not.
    const recovery = await h.request(held.adminOne.session, '/api/invitations',
      { method: 'POST', body: { purpose: 'recovery', personId: invited.json.personId, verification: await freshCheck(held.adminOne.session, phones.adminOne, held.adminOne.credentialId) } });
    assert.equal(recovery.status, 201);
    const recoveryClaim = await h.request(null, '/api/claims', { method: 'POST', body: { token: recovery.json.token } });
    const newPhone = authenticator({ rpId: h.settings.rpId, origin: h.settings.rpOrigin });
    await h.request(null, '/api/claims/' + recoveryClaim.json.claimId + '/register',
      { method: 'POST', body: { response: newPhone.register(recoveryClaim.json.registration, { credentialId: 'briefly-here-new-phone' }) } });
    assert.ok([200, 204].includes((await h.request(held.adminOne.session, route(dept, 'memberships', membershipId), { method: 'DELETE' })).status));
    const approved = await h.request(held.adminTwo.session, '/api/claims/' + recoveryClaim.json.claimId + '/approve',
      { method: 'POST', body: { code: recoveryClaim.json.code, method: 'known-number', verification: await freshCheck(held.adminTwo.session, phones.adminTwo, 'admin-two-phone') } });
    assert.equal(approved.status, 409, 'there is no longer a member to give a replacement passkey to');
    assert.equal((await signIn(newPhone, 'briefly-here-new-phone')).status, 401);
    assert.equal((await signIn(phone, 'briefly-here-phone')).status, 403, 'and the old one is a credential without a membership');
  });

  test('a bootstrap token issued before the first administrator cannot be spent after', async () => {
    // The CLI refuses a second bootstrap. This is the other half: a token minted while the department had no
    // administrator, presented once it has one. The condition is read again at the moment of registration.
    const db = open(h.dbPath);
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO tokens (hash, purpose, person_id, department_id, single_use, created_at, expires_at) VALUES (?,?,?,?,1,?,?)')
      .run(createHash('sha256').update(token).digest('hex'), 'bootstrap', held.rowan.personId, dept,
        new Date().toISOString(), new Date(Date.now() + 3600000).toISOString());
    db.close();
    const claim = await h.request(null, '/api/claims', { method: 'POST', body: { token } });
    assert.equal(claim.status, 201);
    assert.equal(claim.json.purpose, 'bootstrap');
    const phone = authenticator({ rpId: h.settings.rpId, origin: h.settings.rpOrigin });
    const registered = await h.request(null, '/api/claims/' + claim.json.claimId + '/register',
      { method: 'POST', body: { response: phone.register(claim.json.registration, { credentialId: 'late-bootstrap-phone' }) } });
    assert.equal(registered.status, 409, 'the department already has an administrator with a passkey');
    assert.equal((await signIn(phone, 'late-bootstrap-phone')).status, 401);
  });
});
