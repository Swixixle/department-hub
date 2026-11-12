# Joining and signing in

**Decided:** sign-in uses a passkey, with no email typed at sign-in and no Department Hub password. Members enter their own phone number and email address as their own information. This does not forbid collecting email elsewhere. **Open:** the email field's purpose and collection requirements; `EMAIL-OPTIONS.md` records contact information, administrator-only recovery confirmation and separate fields for both as alternatives, not decisions. No email feature or sending mechanism is implemented here. The invitation and recovery details below remain an unbuilt design proposal.

Proposed enrollment implementation, not a built feature: passkeys with the device's existing unlock method. The intended first-join flow is **Open invitation → register a pending passkey → an administrator confirms the intended person and pending claim → activate membership**. Later sign-ins use the device's supported Face ID, fingerprint or PIN/passcode. Do not require biometrics when a supported PIN/passcode method is available, and do not show a Face ID-only button on other devices. Normal app navigation does not run a new sign-in ceremony on every tap.

The PIN here is the existing device unlock method, not a new four-digit password submitted to the department server. An app-specific PIN scheme has not been selected. The app does not capture or store face images, fingerprint templates or that device PIN. Its server would hold an opaque member ID, credential IDs/public keys and sessions. An email address is not the sign-in identifier; its other uses remain open. A passkey unlock identifies the registered credential; department membership and resource permissions still decide what it may access.

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
