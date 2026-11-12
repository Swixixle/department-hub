# Preparing the private department pilot

Updated 2026-11-11 from the owner's clarified direction. This is a plan. The current local build is still one-browser software: shared accounts, storage, messages between devices and notifications are not built.

## The department is the workspace

The owner will introduce the app to willing coworkers in his own department, ask for patience and feedback, and improve it around their actual use. He intends to fund a server in a few weeks. The next milestone is useful adoption in that department.

There is one private workspace for the department and one personal identity per member, enrolled by invitation. The owner explicitly requires no email address or Department Hub password for sign-in. Only approved members can enter. Another job, cross-department membership, global profiles and a workspace switcher are outside the pilot's scope.

The daily experience is one place for the schedule, department updates, due dates, meetings, messages and request conversations. Keep one department feed and stable navigation. Avoid a collection of channels and group-selection screens. Private conversations stay inside the same department.

Information ordinarily sent by email should be easier to notice and consume here. Start with a person posting the relevant announcement, source link and dates. Mailbox ingestion, email credentials and replacing email are not requirements. Seeing an announcement does not establish that a course or official requirement was completed.

## What can be prepared before hosting

Build and test locally using synthetic records, two isolated test departments and separate authenticated test users. Keep the existing local app and fictional public demo usable. Do not silently upload the owner's browser workspace when shared mode becomes available.

### Definition of done: access boundaries first

The first shared milestone is defined by denied access as well as legitimate access. A member must not read, search, change, export or download another department's records by changing an ID. A nonparticipant must not retrieve a trade conversation or its attachments. A membership administrator is not automatically a fairness custodian or conversation participant. Only the subject and an authorized custodian may retrieve a named fairness sheet. Revoking membership must reject existing sessions on their next request, and removing the custodian role must immediately remove that privilege.

Write the synthetic permission contract before account screens or synchronization. `docs/SHARED-CONTRACT.md` specifies the HTTP contract and `npm run test:shared` runs it against a supplied backend fixture. This is a separate launch gate: without a backend it exits nonzero as blocked. Passing the local-app or harness tests does not pass it. A post appearing on another phone remains a useful synchronization check after the access gate; it is not sufficient for launch.

### Membership and accounts

The owner has now explicitly ruled out email/password sign-in. The earlier email/password plan was an inference and is superseded. Invitations identify the intended member and department using stable internal IDs, not an email address. They are single-use and expire. A member keeps the same identity for agreements, personal records and recovery; there is no shared department login or shared PIN.

The proposed implementation is a passkey, unlocked through the phone's existing Face ID, Touch ID or device PIN/passcode. Biometrics stay with the operating system; Department Hub receives a signed response, not face images, fingerprint data or the device PIN. A separate app-specific PIN scheme has not been selected or built. `docs/SIGN-IN.md` describes this passwordless design and its remaining checks. Use a maintained WebAuthn implementation that supports enrollment without collecting an email address; no provider or account backend is built yet.

First enrollment creates a pending claim and grants no department data until an authorized administrator confirms the intended person and that claim through an independently known channel. Either administrator can do this remotely; no shift overlap or simultaneous two-administrator approval is required. A forwarded link, incoming text or newly supplied phone number does not establish identity. Raw invite/recovery links are bearer secrets as well as session tokens. All have explicit purpose, expiry and revocation; invite/recovery links are also consumed only once.

Plan administrator recovery as routine, without assuming coworkers enroll a second device or buy a hardware key. Before the pilot, establish at least two administrators who can recover members independently and remotely. Use the same confirmation discipline for enrollment and every recovery. A lost-admin account is recovered by the other administrator. Activation must preserve the same member and phone-consent choices, revoke old credentials/sessions and recheck current membership/roles atomically. Recovery cannot restore removed membership or revoked privileges. `docs/SIGN-IN.md` specifies the remaining implementation tests; none is implemented yet. Existing passkeys may sync across devices, and fresh verification with an existing credential is required to add another. Separate membership administration from custodian access to named fairness records.

Members enter their own optional phone numbers. Do not upload the whole imported telephone directory on their behalf. Phone sharing defaults off, and each person controls it. A withheld number remains visible to its owner for editing, and is excluded from coworkers' directory, search, Ask and directory exports; membership administrators and fairness custodians have no exception. Withdrawing sharing takes effect on subsequent requests, including already-used lookup routes. Phone numbers are not required for sign-in or recovery. Authenticated membership replaces Viewing as in shared mode. That selector stays only in the local simulation and fictional demo.

### Shared records and department boundaries

The existing src/backend.js adapter handles only the local board. Its methods are list, publish, remove, file and clear, with shared and where properties. The schedule, directory, requests, exchanges, documents, feedback and receipts still need shared service boundaries. Replacing the board adapter alone does not make the app shared.

The proposed data model includes department-scoped members/roles, roster revisions and assignments, posts and private attachments, dated announcements, conversations/messages, requests and exchange acceptances, documents/versions, fairness records, correction feedback and receipts. Use stable IDs for people and records. A department ID provides isolation; it does not require a multi-department user interface.

Derive the authorized department and person from the server session. Check membership and resource permissions on every request: listing, search, direct URLs, uploads/downloads, message recipients, exports and Ask retrieval. Changing a supplied ID must never expose another department. Within a department, only conversation participants may retrieve private messages, and only authorized custodians may retrieve restricted named fairness records. Hidden buttons are not authorization.

Use private file storage with authorized downloads or short-lived links issued after access checks. Scope caches, search indexes, audit chains and backups to the department and, where needed, the person. A member clearing their device must not erase the shared department.

A simple bounded refresh can precede live updates. Show loading, stale-data, failed-save and unsent states accurately. Prevent duplicate submissions on reconnection.

### A feed people can readily check

Recommended first shared screen: the person's next shift, important department updates, approaching meetings/due dates and unread messages, with clear links into the existing views. Reuse the current interface before adding navigation.

Prepare a per-person read position and visible new-item indicators. Announcements can carry source, author, due/meeting/event dates and an important/pinned status. Include correction, post-reporting and app-feedback routes. A read marker is not evidence of attendance, course completion or assent.

Plan opt-in notification preferences and minimal-content notices that avoid exposing department material on a locked phone. The unread view must work if permission or delivery is unavailable. Verify notifications on actual phones before relying on them; publishing a web app alone is not notification delivery.

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
| Passwordless enrollment and sessions | Member-bound invitations, passkeys, device unlock, recovery and chosen WebAuthn integration | No email/password required; real-device enrollment/unlock, single-use invites and recovery work; rerun the same access gate with real sign-in sessions |
| Shared consumption | Versioned roster, feed, dated/pinned posts, personal unread state and directory self-entry | Another signed-in phone receives a post and schedule correction; failure and stale states are accurate |
| Conversations and exchanges | Private messages, request threads, immutable proposals and atomic agreement | Only participants can read messages; distinct accounts accept; competing trades cannot double-commit |
| Reliable pilot | Notifications, reporting/removal, reviewed corrections, backups and checkpoints | Actual-phone checks, successful restore including media, failure tests and a short member-facing privacy explanation |

Recruit a few willing coworkers first, with an obvious feedback route and clear expectations that it is an independent pilot. Observe finding a next shift, new announcement, deadline and conversation. When shared agreement is ready, observe a complete exchange from separate accounts. The existing docs/USER-TEST.md is a local-prototype exercise; shared pilot tasks should match the capabilities enabled.

## Hosting decision

The owner intends to pay for a server. Provider and budget are not settled here. Cloudflare Workers/D1/R2 was an earlier proposed route, not a deployed backend or a final requirement. Select hosting that supports authentication, database transactions, private files, recovery and the operational responsibilities above. Verify current pricing, limits and terms when choosing it rather than relying on earlier free-tier figures.

Prepare concrete configuration, domain/TLS setup, storage, backup, permissions and recurring-cost estimates before deployment. This document creates no hosting account, incurs no charges and changes no running app behavior.
