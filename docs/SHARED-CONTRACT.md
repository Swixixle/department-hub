# Shared permission launch gate

Status: contract tests written; shared backend, fixture seeder, sign-in and synchronization are not implemented. No access-control claim is established by this document. Version 15 on the Mac is unchanged.

**Decided clarification:** sign-in uses a passkey with no email typed at sign-in; members enter their own phone/email information. **Open:** email as optional contact information, an administrator-only recovery-confirmation channel, or separate fields for both. Nothing here selects one, and this contract covers phone only.

## Run against the actual backend

Start an isolated server and seed only synthetic records, then have that server's test setup write a fresh manifest following `tests/shared/fixture.example.json`. Keep the generated manifest and its credentials in ignored `local-data/`; never use a coworker's session, schedule or contact data. Reset the fixture for every run because the suite creates/deletes a control post, records one participant acceptance, adds/changes contact sharing, removes a custodian role and revokes membership.

```sh
DEPARTMENT_HUB_TEST_FIXTURE="$PWD/local-data/shared-fixture.json" npm run test:shared
```

Without that environment variable the command exits 2 and says the gate has **not passed**. A supplied manifest with an unreachable server, invalid sessions, missing routes or failing assertions also exits nonzero. It does not skip cases, turn expected failures green or fall back to an in-memory backend. `npm test` checks the existing local app and a few test-harness assertions; those passing does not pass this gate.

The tests make real HTTP requests using fresh authenticated sessions. The manifest may supply an Authorization header or Cookie header for each session. It cannot supply trusted person/department/role headers. This deliberately leaves the sign-in mechanism open while testing the server's treatment of authenticated identity. When account enrollment and the chosen authentication integration exist, rerun using credentials from that same implementation; a test-only identity adapter is not evidence that real sign-in is correct. Fixture setup must not become a public production endpoint or bypass normal request authorization.

Sign-in uses a passkey without typing email or a Department Hub password. That does not prohibit email information for another purpose. The proposed enrollment flow is in `docs/SIGN-IN.md`; fixture sessions authenticate with existing test tokens, not contact addresses or biometric data. Sessions produced by the eventual passkey flow must satisfy the same contract.

## Seed and response contract

This is the initial backend API contract, not a description of existing routes. Changes to it need corresponding reviewed test changes; do not add a proxy that fabricates answers to satisfy the suite.

- Two departments and seven distinct people: a member, their trade partner, an outsider, a fairness custodian, a membership administrator, a member of the other department and a member to revoke. The revocable person has two independent existing sessions. All except the foreign member belong to the first department. The membership administrator has no custodian role and is not in the trade.
- A post, document and department attachment in each department. Put `fixture-signal` and a unique marker containing the fresh run ID in their actual searchable content/bytes. The local post must be visible to the board-new-items Ask query.
- One private trade conversation and attachment readable by the member and partner, plus a valid pending exchange linked to it. Start with no participant acceptances. The fixture must make a partner's acceptance legitimate under current roster and rule checks.
- Known named fairness records for the member and partner, with `weekendTurns` matching the manifest. These are test fixture expectations, not a new fairness algorithm.
- Optional contacts: the member has explicitly shared their fictional number, the partner has explicitly withheld theirs, and the outsider has a number with no sharing consent set (default private). The keeper starts with no number and sharing off; a test adds their number without a sharing flag and requires it to remain private. Use distinct reserved 555-01xx numbers from `contacts` in the fixture manifest. The owner can retrieve/edit their own private contact through the self-profile route.

All resources are addressed beneath `/api/departments/:departmentId`. Session inspection is `GET /api/session`, returning `{personId, departmentId}`. Seeded members authenticate through the same request boundary being tested; the server derives identity and authority from those sessions.

| Routes | Required behavior and controls |
| --- | --- |
| `GET /posts`, `POST /posts`, `GET/PATCH/DELETE /posts/:id` | Lists and reads are scoped; creation returns 201 with `{id, authorId, departmentId}`; a legitimate owner can edit/delete a disposable control post; denied foreign writes leave the foreign record unchanged |
| `GET /documents/:id`, `GET /directory` | Department-scoped content; the directory includes the authenticated person's ID |
| `GET/PATCH /profile` | Self-only `{personId,phone,sharePhone}`; phone is optional/null, sharing defaults false, supplying another person ID cannot edit their sharing; changes return the updated self record |
| `GET /directory/:personId`, `GET /exports/directory` | Shared numbers are retrievable by coworkers; withheld numbers are absent/null for other people, including administrators and custodians; directory exports use the same visibility rules |
| `GET /files/:id` | Returns actual seeded bytes through an authenticated path; private thread files require participation; HEAD, Range and conditional requests cannot bypass the department check |
| `GET /conversations/:id`, `POST /conversations/:id/messages` | Only participants may read/reply; a legitimate reply returns 201 with the session's `authorId` and is visible to the partner; outsider attempts must leave the thread unchanged |
| `GET /exchanges/:id`, `POST /exchanges/:id/accept` | Only involved people can retrieve/accept the private proposal; acceptance uses the authenticated participant, and GET returns `acceptedBy` person IDs |
| `GET /fairness/:personId`, `GET /exports/fairness` | Personal records contain `personId` and `weekendTurns`; only self/custodian can read a named record, and named exports require a custodian; the export's `people` includes the seeded partner's actual values |
| `GET /search?q=fixture-signal` | Returns an array of `{kind,id,...}` sources with accessible content only; legitimate local post retrieval is checked, not merely an empty success |
| `POST /ask` with `{question}` | Returns `{sources:[{kind,id,...}],...}`; the board question returns the seeded local post without foreign content or private sources inaccessible to the caller |
| `PATCH /memberships/:id` with `{roles:["member"]}` | An authorized administrator can remove a custodian role; the existing session loses that privilege on its next request |
| `DELETE /memberships/:id` | An authorized administrator revokes membership; both existing sessions immediately fail reads, downloads, search, Ask and writes without a refresh/login/expiry wait |

Successful read controls return 200 and actual seeded content. Denials return 401, 403 or 404, with no protected marker in the response body or headers. Redirects, partial-content successes and server errors are not denials. A forged department/author in a new post must either be rejected with 400/403 or ignored while the server uses the actual session's owner and department.

Positive controls run before negative assertions: a backend that rejects everybody, omits write routes, returns empty placeholder records or never performs revocation cannot pass. Failed mutation checks also read back the protected record so "changed it, then returned forbidden" fails.

Source kinds are `post`, `document`, `file`, `conversation`, `fairness`, `schedule` and `person`. Private conversation content uses the conversation ID, attachments use their file ID, and named fairness uses the subject person's ID. Unknown kinds require a reviewed contract update; they cannot silently bypass source checks. Both legitimate and unauthorized requests hit the same seeded records, so the negative cases also follow already warmed reads.

Phone controls prove an explicitly shared number is returned through directory list/detail, name search, the named-number Ask question and directory export. Private-number checks then exercise those same routes across coworkers, administrators and custodians. The phone assertion checks raw, formatted and encoded numbers in content and headers. Sharing-withdrawal checks first warm every route with a real shared result, then require the same existing session to stop receiving it on the next request. Search sources may still identify the coworker; their name is not treated as a private phone number. Consent applies to the structured contact record, not a promise to erase screenshots, previously downloaded copies or independently authored text.

## What still remains

There is no shared server or seeder to run this against yet, so the real permission gate remains blocked. This finite contract is the initial minimum, not exhaustive proof of authorization correctness. The backend must add coverage as routes, caches, uploads, invitations and recovery are implemented. Atomic trade conflicts and stale-proposal rejection require their own real-database tests. A later two-phone test must exercise the chosen sign-in integration, permissions and synchronization together. Revocation rejects future server requests; it cannot recall bytes already downloaded. Existing public or independently usable storage URLs need explicit handling before claiming that those access paths are revoked too.

Before enabling shared mode, the backend implementation must wire its server startup, fresh seeding and this command into a required CI job. That job does not exist yet. The current local-app CI is not a substitute for that launch gate.
