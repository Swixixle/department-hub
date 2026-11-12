# Joining and signing in

**Decided:** sign-in uses a passkey, with no email typed at sign-in and no Department Hub password. Members enter their own phone number and email address as their own information. This does not forbid collecting email elsewhere. **Open:** the email field's purpose and collection requirements; `EMAIL-OPTIONS.md` records contact information, administrator-only recovery confirmation and separate fields for both as alternatives, not decisions. No email feature or sending mechanism is implemented here. The invitation and recovery details below remain an unbuilt design proposal.

Proposed enrollment implementation, not a built feature: passkeys with the device's existing unlock method. The intended first-join flow is **Open invitation → register a pending passkey → an administrator confirms the intended person and pending claim → activate membership**. Later sign-ins use the device's supported Face ID, fingerprint or PIN/passcode. Do not require biometrics when a supported PIN/passcode method is available, and do not show a Face ID-only button on other devices. Normal app navigation does not run a new sign-in ceremony on every tap.

The PIN here is the existing device unlock method, not a new four-digit password submitted to the department server. An app-specific PIN scheme has not been selected. The app does not capture or store face images, fingerprint templates or that device PIN. Its server would hold an opaque member ID, credential IDs/public keys and sessions. An email address is not the sign-in identifier; its other uses remain open. A passkey unlock identifies the registered credential; department membership and resource permissions still decide what it may access.

## What is built now

The server side of all of this, with tests. The phone side is not: there is no screen in the app for any of it yet,
and no real device has been through it.

```
an administrator issues an invitation  ->  the person opens it and registers a passkey  ->  a PENDING CLAIM
an administrator confirms who that is, through a channel outside this app  ->  the claim is activated
```

Routes: `POST /api/invitations` (administrator, with a fresh passkey check), `POST /api/claims` to consume the link,
`POST /api/claims/:id/register`, `GET /api/claims` for the waiting list, `POST /api/claims/:id/approve`,
`POST /api/passkeys/authentication/options` and `/authentication` to sign in, `/verification/options` and
`/verification` to prove it again, `/registration/options` and `/registration` to add a second passkey, and
`GET /api/passkeys` for what a person can see of their own.

Implemented with `@simplewebauthn/server` 14.1.0, which requires Node 22 or later, as this repository already does.
Registration and authentication are verified by that library against a relying party ID and origin taken from
`DEPARTMENT_HUB_RP_ID` and `DEPARTMENT_HUB_RP_ORIGIN`, both defaulting to localhost for development.

The parts worth stating plainly, because each is a thing that could have been got wrong:

- Holding the link does nothing. Consuming it creates a claim, not a session; the claim expires; and until an
  administrator approves it the membership has no `activated_at`, which means it grants nothing anywhere in the API.
  A credential that has been registered but not confirmed gets the same answer at sign-in as one the server has
  never seen.
- The claim shows the joining device a six-character code. The administrator hears it over a channel they already
  had and types it in, which binds the confirmation of a person to one particular credential rather than to a name.
  The code is not in the waiting list the administrator sees, because then it would not be a confirmation of
  anything.
- Approval needs a current administrator **and** a fresh passkey check, which is a short-lived single-use proof that
  the administrator just unlocked their own phone. A retained session is not enough and neither is a session token
  presented in its place. An administrator cannot approve their own device; that is what the second one is for.
- Four kinds of bearer secret — session, invitation, recovery link, fresh check — each with its own purpose, expiry
  and revocation, and none usable in another's place. The last three are single-use; a session is not, which is the
  point of it. Raw secrets are returned once in a response body and never written into a receipt.
- Recovery is one operation: the confirmed replacement credential becomes live, every older credential of that
  person and every session bound to one is revoked, and the person, their history and their contact-sharing choices
  are untouched. It will not reactivate a membership that was revoked and will not hand back a role that was taken
  away, both rechecked at the moment of activation rather than when the claim was made.
- Adding a second passkey while one still works needs a fresh check with an existing credential. A stolen session
  cannot quietly enrol another device.
- The server stores an opaque person ID, credential IDs, public keys, counters and sessions. No face image, no
  fingerprint template, no device passcode, and no app-specific PIN of its own invention.

The first administrator is the one case with nobody to confirm them, so `node server/bootstrap.mjs` creates that
person and one single-use registration link on the machine holding the database. It is a command, not a route, so it
cannot be reached over the network; it refuses to run once the department has an administrator with a passkey, and
the server checks that same condition again when the link is spent. Everyone after that, administrators included,
goes through confirmation. Having two capable administrators before a real pilot is something the owner does; this
command does not establish it.

`tests/server/passkeys.test.mjs` is 31 tests over real HTTP with a software authenticator that produces real P-256
signatures, checked by the real library: enrollment, sign-in, a wrong signature, a cancelled prompt, an unknown
credential, replay, expiry of every short-lived secret, pending access, remote approval by either administrator,
recovery, old-session invalidation, a role removed while a claim waited, a membership revoked while a claim waited,
wrong-purpose tokens, and the bootstrap window closing. Four of those tests exist because the earlier set was run
against deliberately broken copies of the server and did not catch the corresponding fault.

**What none of that shows.** There is no phone in any of it. No Face ID, no fingerprint reader, no device passcode,
no platform authenticator, no browser, and a relying party of `localhost` — which proves nothing about a relying
party on a domain the owner controls. Choosing that domain is a deployment decision and has not been made. The
two-person confirmation exercise is a thing two people do; a recorded confirmation method in the database is not
evidence that a human made the call, and the tests say so where they assert it.

## First enrollment and confirmation

Issue a single-use, short-lived invite bound to the intended department member. Consuming it creates a pending credential claim, not an active member session or department-data access. The pending claim also expires. Selecting a coworker's name or receiving a forwarded link cannot complete enrollment by itself.

Either authorized administrator can confirm enrollment remotely. Do not require two administrators at once or people to be on the same shift. Use a pre-existing, independently known contact/work channel and confirm the intended coworker; an incoming text, typed name or newly supplied callback number is not sufficient. While using that known channel, compare the one-time claim identifier displayed on the person's joining device with the pending claim being approved. The identifier binds the confirmation to that credential claim; it is not identity proof on its own.

The administrator's approval requires their own authenticated, currently authorized session with fresh passkey verification. Approval checks the still-valid invite/claim, intended member, approving administrator and department before activating the credential. Replayed, expired or revoked claims cannot be approved. Record the approving administrator, affected member, claim/credential references and confirmation-method category. Do not record private phone numbers, call/message contents, biometric data or raw link tokens. An unverified claim must not be recorded as though the named coworker had authenticated.

## Routine recovery

Plan for administrator-assisted recovery as a normal lost-phone workflow. A second personal device, hardware key or backup passkey is not an enrollment requirement. Offer additional passkeys where useful, but assume that many members will not have one. Passkeys may be synced by the user's provider; do not assume a credential represents one physical phone.

Before the pilot, designate at least two administrators who can each handle recovery independently and remotely. An administrator who loses every usable credential must be recovered by the other administrator; they cannot approve their own unauthenticated recovery. Do not plan routine recovery around only the owner's availability.

Recovery uses the same person-confirmation discipline as first enrollment. Either administrator may initiate it for an existing member, but a request saying "new phone" does not authorize a reset. Confirm through an independently known channel, correlate the new device's pending claim, and approve only that claim. This does not require publishing a private contact number or uploading the phone list. The confirmation procedure is repeated for every recovery, including familiar coworkers and urgent requests. Recording a method in the app does not itself prove that the human performed the check.

Activate the replacement credential and invalidate old credential records and sessions in one checked operation. Keep the same member identity, history and contact-sharing choices. Recheck current membership and roles; recovery must not reinstate a removed member or restore revoked custodian/admin powers. Record who approved the reset and which credentials/sessions were invalidated, and make the recovery event visible to the affected member and the other administrator. This does not select email delivery. Synced copies of one credential share its credential ID; revoking that record affects all copies, not just one physical phone.

Adding a passkey while an existing one still works is a separate authenticated operation. Require fresh verification with an existing passkey rather than treating a retained bearer session alone as authority to bind a new authenticator. Whether an administrator-only email field participates in recovery remains open; do not infer a contact or recovery-email requirement from this proposal.

## Token and domain boundaries

Session tokens and unused invitation/recovery links are bearer secrets. Give each an explicit purpose, scope and lifetime; enrollment/recovery tokens cannot substitute for active member sessions. Store token records appropriately, consume/revoke them atomically, and keep raw tokens out of receipts, logs, analytics, search and Ask. Session expiry and revocation remain server checks, not browser controls.

Choose an owner-controlled, stable HTTPS login domain and RP ID before real enrollment. Keep ownership and renewal under the operator's control. Hosting may change while preserving that identity and account/credential records. A domain has not been selected or registered by this work. Use a maintained WebAuthn server implementation with verified challenges, origin/RP checks and user verification.

## Implementation and evidence still required

Credential registration/authentication, session handling, invite claims/approval, recovery and server authorization are all unbuilt. The existing shared permission suite remains blocked until a backend and fixture seeder exist. Authentication/recovery must add actual implementation tests for:

- Pending or forwarded invites grant no department data before confirmed approval; expired, replayed and revoked invites/claims fail.
- Either administrator completes confirmation and recovery remotely; wrong-person/wrong-claim confirmation and self-approval of lost-admin recovery fail.
- Only a currently authorized administrator with fresh verification can approve; revocation or a changed claim between review and activation is rechecked.
- Lost-phone recovery preserves the member and consent settings, invalidates old credentials/sessions and does not restore revoked membership/roles.
- Expired sessions and wrong-purpose tokens fail; a bearer session alone cannot silently add a passkey.
- Wrong origins/challenges, failed/cancelled local unlock and unsupported-device behavior are handled accurately.

Run the shared permission suite with the actual sign-in implementation. A real two-person remote recovery exercise is also required; one operator clicking both sides is not evidence of person confirmation. These are requirements, not passing tests or a completed recovery service. No change to the installed Mac app is made by this document.

Primary references: [FIDO passkeys](https://fidoalliance.org/passkeys/), [Apple passkeys](https://developer.apple.com/passkeys/), [WebAuthn](https://www.w3.org/TR/webauthn/), [NIST account recovery](https://pages.nist.gov/800-63-4/sp800-63b.html#account-recovery), and [OWASP token handling](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html). These inform this design; this document does not claim a certified assurance level or completed implementation.
