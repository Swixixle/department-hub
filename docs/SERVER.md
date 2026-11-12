# Preparing the private department pilot

Updated 2026-11-12. The parts of this that are now built are listed under **What is built now** below; the rest is still a plan. The phone app is still one-browser software: it has not been connected to the server, and shared accounts, messages between devices and notifications are not built.

**Clarification — decided:** passkey sign-in with no email typed at sign-in; members supply their own phone/email information; no app-sent email/text is authorized by this work. **Open:** email's purpose, collection requirements and app-sent notifications. `EMAIL-OPTIONS.md` records alternatives, not a selected design. The implementation stages below remain proposals, not built features.

**Clarification — decided:** passkey sign-in with no email typed at sign-in; members supply their own phone/email information; no app-sent email/text is authorized by this work. **Open:** email's purpose, collection requirements and app-sent notifications. `EMAIL-OPTIONS.md` records alternatives, not a selected design. The implementation stages below remain proposals, not built features.

## The department is the workspace

The owner will introduce the app to willing coworkers in his own department, ask for patience and feedback, and improve it around their actual use. He intends to fund a server in a few weeks. The next milestone is useful adoption in that department.

There is one private workspace for the department and one personal identity per member, enrolled by invitation. Passkey sign-in requires no typed email or Department Hub password; this is not a prohibition on collecting email information. Only approved members can enter. Another job, cross-department membership, global profiles and a workspace switcher are outside the pilot's scope.

The daily experience is one place for the schedule, department updates, due dates, meetings, messages and request conversations. Keep one department feed and stable navigation. Avoid a collection of channels and group-selection screens. Private conversations stay inside the same department.

Information ordinarily sent by email should be easier to notice and consume here. Start with a person posting the relevant announcement, source link and dates. Mailbox ingestion, email credentials and replacing email are not requirements. Seeing an announcement does not establish that a course or official requirement was completed.

## What is built now

A locally runnable server with persistent records, a repeatable synthetic seeder, and the permission contract passing
against both. Passkey sign-in and the app's own connection to it are not built; the section below this one is still
the plan for those.

```sh
npm run gate:shared     # start the server, seed a fresh synthetic fixture, run the permission contract, exit with its status
npm run test:server     # the server's own implementation tests: permissions, passkeys, and the shared board
npm run server          # run it to talk to by hand: DEPARTMENT_HUB_DB=./local-data/hub.sqlite npm run server -- --port 18080
npm run seed:shared     # write a synthetic fixture and its manifest into local-data/
npm run bootstrap:admin # the department's first administrator and their one-time passkey link
```

`.github/workflows/shared-gate.yml` runs the first two on every pull request, and then does one more thing: it
removes the phone-sharing filter from the server and requires the gate to fail. A gate that would pass a backend
with no access control is not a gate, so the job proves it is load-bearing rather than merely green.

Routine technical choices, and why:

- **`node:sqlite`, built into Node 22.5 and later.** The repository has two dependencies, Vite and Tesseract. A
  database that needs neither a native build nor a running service keeps it that way, and it gives real files, real
  transactions and real constraints — which is what "a denied write leaves nothing changed" and "a trade commits or
  does not" actually require. It is still marked experimental in Node, so the schema is kept in one file
  (`server/db.mjs`) and every query is plain SQL, so moving to another SQLite driver or to Postgres later is a
  change of driver rather than a rewrite.
- **`node:http` with a small router.** No framework. The whole surface is one file of handlers
  (`server/api.mjs`) and the request plumbing is another (`server/index.mjs`).
- **One database file per department pilot, loopback by default.** It listens on 127.0.0.1 unless told otherwise.
- **Configuration is non-secret and all in environment variables**: `DEPARTMENT_HUB_DB`, `DEPARTMENT_HUB_PORT`,
  `DEPARTMENT_HUB_HOST`, `DEPARTMENT_HUB_ORIGIN`, `DEPARTMENT_HUB_BUILD`, and the relying-party settings
  `DEPARTMENT_HUB_RP_ID`, `DEPARTMENT_HUB_RP_NAME`, `DEPARTMENT_HUB_RP_ORIGIN`.

How identity is decided, in one paragraph, because everything else rests on it: a request carries a bearer token and
nothing else that counts. The token's hash is looked up, the membership it names is read again from the database, and
that membership's roles are parsed on every request. So removing a role or revoking a membership takes effect on the
next request with no logout, refresh or expiry wait. A person, department, role or actor named in a request body,
query string or header is either refused outright or ignored. The permission decisions happen while the caller's view
of the records is being assembled (`server/world.mjs`), so the search and the Ask engine never hold a record the
asker may not see; nothing is filtered out of an answer after the fact.

What the seeder will not do: it refuses to run against a database holding records it did not create, it invents every
name, number and shift it writes, and it never reads the owner's workspace or his imported telephone list. The
numbers are reserved 555-01xx numbers. Its manifest contains live test sessions, so it is written into ignored
`local-data/`.

This is a local service. It is not a deployment, it selects no hosting provider or domain, and a passkey registered
against `localhost` would prove nothing about a production relying party.

## What can be prepared before hosting

Build and test locally using synthetic records, two isolated test departments and separate authenticated test users. Keep the existing local app and fictional public demo usable. Do not silently upload the owner's browser workspace when shared mode becomes available.

### What the app does with any of this: nothing yet

The adapter is written and tested; no screen calls it. `src/backend.js` now has `sharedBoard` beside `localBoard`,
offering the same six functions over HTTP, so nothing above that line has to know which one is in use. What differs
is visible on purpose:

- `where` says the department rather than this browser.
- `state` is `ready`, `stale`, `failed`, `sending` or `unsent`, and the difference between the last few matters. A
  dropped connection keeps the posts already on screen and marks them old. A refusal — a revoked membership, a
  department that is not yours — throws the local copy away, because somebody who has been removed should not keep
  reading the board from a cached copy, even one labelled stale.
- A post carries an id the phone made before sending. A retry after a dropped connection carries the same one and
  the server returns the post that is already there, so a flaky signal does not post twice.
- `clear()` does nothing at all. A member wiping their own device must not empty the department.
- Attachments go up as their own bytes rather than inflated through JSON, belong to nobody's post until a post names
  them, and can only be named by whoever uploaded them. Removing a post removes its own attachments and nothing
  else.

`tests/server/shared.test.mjs` runs that adapter against the real server with two members who each signed in with
their own passkey: one publishes, the other receives, a member of the other department gets nothing by board,
search, Ask or file download, and a revoked member stops receiving on the next read. It also covers the stale and
unsent states, the duplicate-free retry, attachment bytes round-tripping through the authorized path, and that
reading, searching and asking add no receipt, keep no question text and keep no question fingerprint.

An exchange is rechecked at every acceptance, before that person's agreement is recorded: each shift in it still
exists, is still held by the person the proposal says holds it, and is still at the revision the proposal was built
against; and the department's trade rules have not changed. The check is per shift, so a trade elsewhere in the
department does not invalidate this one. All of it happens in one database transaction, and the shifts move only
when the last person has agreed.

**Two caveats, stated rather than buried.** The concurrency test runs in one process against one SQLite file, where
writes serialize anyway: it shows the transaction holds and the second request is refused, not that a
multi-process deployment is safe. And a two-session exercise is not a two-phone exercise — there is no phone,
browser, Face ID or fingerprint reader anywhere in these tests, and the relying party is localhost.

### Definition of done: access boundaries first

The first shared milestone is defined by denied access as well as legitimate access. A member must not read, search, change, export or download another department's records by changing an ID. A nonparticipant must not retrieve a trade conversation or its attachments. A membership administrator is not automatically a fairness custodian or conversation participant. Only the subject and an authorized custodian may retrieve a named fairness sheet. Revoking membership must reject existing sessions on their next request, and removing the custodian role must immediately remove that privilege.

Write the synthetic permission contract before account screens or synchronization. `docs/SHARED-CONTRACT.md` specifies the HTTP contract and `npm run test:shared` runs it against a supplied backend fixture. This is a separate launch gate: without a backend it exits nonzero as blocked. Passing the local-app or harness tests does not pass it. A post appearing on another phone remains a useful synchronization check after the access gate; it is not sufficient for launch.

### Membership and accounts

Sign-in is by passkey, without typing email or a Department Hub password. The earlier blanket prohibition on email collection was an incorrect inference. Invitations identify the intended member and department using stable internal IDs, not an email sign-in field. They are single-use and expire. A member keeps the same identity for agreements, personal records and recovery; there is no shared department login or shared PIN.

The proposed implementation uses the phone's existing Face ID, Touch ID or device PIN/passcode to unlock its passkey. Biometrics stay with the operating system; Department Hub receives a signed response, not face images, fingerprint data or the device PIN. A separate app-specific PIN scheme has not been selected or built. `docs/SIGN-IN.md` describes this design and its remaining checks. Use a maintained WebAuthn implementation that does not require email as a sign-in identifier; no provider or account backend is built yet.

First enrollment creates a pending claim and grants no department data until an authorized administrator confirms the intended person and that claim through an independently known channel. Either administrator can do this remotely; no shift overlap or simultaneous two-administrator approval is required. A forwarded link, incoming text or newly supplied phone number does not establish identity. Raw invite/recovery links are bearer secrets as well as session tokens. All have explicit purpose, expiry and revocation; invite/recovery links are also consumed only once.

Plan administrator recovery as routine, without assuming coworkers enroll a second device or buy a hardware key. Before the pilot, establish at least two administrators who can recover members independently and remotely. Use the same confirmation discipline for enrollment and every recovery. A lost-admin account is recovered by the other administrator. Activation must preserve the same member and phone-consent choices, revoke old credentials/sessions and recheck current membership/roles atomically. Recovery cannot restore removed membership or revoked privileges. `docs/SIGN-IN.md` specifies the remaining implementation tests; none is implemented yet. Existing passkeys may sync across devices, and fresh verification with an existing credential is required to add another. Separate membership administration from custodian access to named fairness records.

Members enter their own phone/email information. Do not upload the whole imported directory on their behalf. Existing phone direction remains optional entry, sharing off by default and owner-controlled withdrawal. A withheld number remains visible to its owner and excluded from coworkers' directory, search, Ask and directory exports; administrators/custodians have no exception. Email's purpose is open: optional contact sharing, administrator-only recovery confirmation, or two separate fields for both. The contact candidate would use the same visibility/withdrawal rules; the recovery candidate would never enter the directory and could not be edited by the person requesting recovery. See `EMAIL-OPTIONS.md`; neither is selected or implemented. Authenticated membership replaces Viewing as in shared mode. That selector stays only in the local simulation and fictional demo.

### Shared records and department boundaries

The existing src/backend.js adapter handles only the local board. Its methods are list, publish, remove, file and clear, with shared and where properties. The schedule, directory, requests, exchanges, documents, feedback and receipts still need shared service boundaries. Replacing the board adapter alone does not make the app shared.

The proposed data model includes department-scoped members/roles, roster revisions and assignments, posts and private attachments, dated announcements, conversations/messages, requests and exchange acceptances, documents/versions, fairness records, correction feedback and receipts. Use stable IDs for people and records. A department ID provides isolation; it does not require a multi-department user interface.

Derive the authorized department and person from the server session. Check membership and resource permissions on every request: listing, search, direct URLs, uploads/downloads, message recipients, exports and Ask retrieval. Changing a supplied ID must never expose another department. Within a department, only conversation participants may retrieve private messages, and only authorized custodians may retrieve restricted named fairness records. Hidden buttons are not authorization.

Use private file storage with authorized downloads or short-lived links issued after access checks. Scope caches, search indexes, audit chains and backups to the department and, where needed, the person. A member clearing their device must not erase the shared department.

A simple bounded refresh can precede live updates. Show loading, stale-data, failed-save and unsent states accurately. Prevent duplicate submissions on reconnection.

### A feed people can readily check

Recommended first shared screen: the person's next shift, important department updates, approaching meetings/due dates and unread messages, with clear links into the existing views. Reuse the current interface before adding navigation.

Prepare a per-person read position and visible new-item indicators. Announcements can carry source, author, due/meeting/event dates and an important/pinned status. Include correction, post-reporting and app-feedback routes. A read marker is not evidence of attendance, course completion or assent.

Open question: whether the app should contact people at all. App-sent email/text would add a sending service and costs, a sending domain, possible hospital spam filtering and interruptions to coworkers. No delivery mechanism is designed or authorized here. Leave Share unchanged: it transfers a post/files through the person's own apps, without attaching coworker addresses or the directory. The in-app unread view remains useful without external delivery.

### Separate-person agreements

Retain the current whole-exchange arithmetic and immutable proposal details. Add authenticated acceptance by each participant from their own session. A person must not accept for someone else by selecting their name.

At final acceptance, one database transaction must recheck membership/permissions, proposal version, roster revision, shift ownership/reservations and current rules, then record the agreement, reserve every move and write its receipt together. A competing request or stale version must fail without a partial exchange. Client checks explain options; the server decides whether an agreement can be recorded.

The result remains queued for coordinator review. Agreement in the app and entry of an approved change into the official system are separate events. Do not enable shared agreement until competing-request and transaction tests pass.

### Documents, Ask and corrections

Ask remains LLM-free and may retrieve only records the authenticated person can access. Apply permissions before search results, caches or any later model receive the text. Department membership does not grant access to every private conversation or named fairness record.

An approved, complete, current employer policy corpus has not been established. Added documents need source, effective/version dates and a named review responsibility. Human notes stay labelled and linked. Correct a roster error in the roster, a source error through document replacement/withdrawal, and a wrong search match through reviewed passage feedback. Save a question's wording only after explicit review.

No outside AI service, automatic paraphrasing or semantic-model download is needed for the pilot. Browser embeddings and generative models remain separate proposals requiring accuracy, permissions and actual-phone performance checks.

### Privacy, receipts and operation

Keep the independent-product notice and prohibition on patient information. Improve the text screen from reviewed false-positive examples; it remains incomplete and does not inspect media or uploaded document contents. Add reporting, administrator removal and a response route before uploads reach coworkers.

The server should record changes, proposal versions, acceptances, rule changes and exports with authenticated identity and server time. Serialize receipt writes per department and retain checkpoints independently of the primary database. Receipts support integrity comparison, not factual correctness, hospital approval or proof that a downstream transfer completed.

Keep receipts for changes, agreements, rule changes, saved corrections and export requests. Ordinary browsing and Ask lookups keep anonymous action totals only: no account, person, record ID, question fingerprint or individual timestamp in a navigation event. Store each person's unread position as private application state; it is not a receipt or a read-status dashboard for coworkers. Keep infrastructure access/error logs separate, omit question text and content-bearing URLs, and set their retention before rollout. Do not attach session or account IDs to anonymous usability totals.

The local app now follows that receipt scope. Existing older browsing receipts are retained unchanged so their hashes and independently saved checkpoints remain valid; this is not retroactive erasure. Backups and receipt exports include their own export-request receipt. Shared mode still requires authenticated identities and server enforcement; the current profile selector is only a local courtesy.

Prepare backups and tested restore of structured data and attachment bytes, retention/deletion, failure reporting, spending limits and dependency updates. Existing browser JSON backups exclude source photos and board media bytes. A migration must not claim those files were copied unless their bytes were transferred and verified. No private data is uploaded as part of this plan.

## Implementation order and launch checks

| Stage | Prepare | Evidence before enabling |
| --- | --- | --- |
| Permission contract first | Synthetic departments, principals, role and resource boundaries, HTTP tests before account screens or sync | Real backend passes `npm run test:shared`, including allowed controls, cross-department denials, private threads/files, custodian restrictions and immediate revocation; no backend means blocked, not passed |
| Passwordless enrollment and sessions | Member-bound invitations, passkeys, device unlock, recovery and chosen WebAuthn integration | No email typed at sign-in or Department Hub password; real-device enrollment/unlock, single-use invites and recovery work; rerun the same access gate with real sign-in sessions |
| Shared consumption | Versioned roster, feed, dated/pinned posts, personal unread state and directory self-entry | Another signed-in phone receives a post and schedule correction; failure and stale states are accurate |
| Conversations and exchanges | Private messages, request threads, immutable proposals and atomic agreement | Only participants can read messages; distinct accounts accept; competing trades cannot double-commit |
| Reliable pilot | Reporting/removal, reviewed corrections, backups and checkpoints; external notification choice remains open | Actual-phone checks, successful restore including media, failure tests and a short member-facing privacy explanation |

Recruit a few willing coworkers first, with an obvious feedback route and clear expectations that it is an independent pilot. Observe finding a next shift, new announcement, deadline and conversation. When shared agreement is ready, observe a complete exchange from separate accounts. The existing docs/USER-TEST.md is a local-prototype exercise; shared pilot tasks should match the capabilities enabled.

## Hosting decision

The owner intends to pay for a server. Provider and budget are not settled here. Cloudflare Workers/D1/R2 was an earlier proposed route, not a deployed backend or a final requirement. Select hosting that supports authentication, database transactions, private files, recovery and the operational responsibilities above. Verify current pricing, limits and terms when choosing it rather than relying on earlier free-tier figures.

Prepare concrete configuration, domain/TLS setup, storage, backup, permissions and recurring-cost estimates before deployment. This document creates no hosting account, incurs no charges and changes no running app behavior.
