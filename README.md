# Department Hub

A small department workspace with a roster, a department board, and conversations attached to trade and coverage requests. The public demo uses fictional data. The standalone local build accepts PNG, JPEG, and WebP screenshots.

Current source/demo release: **Version 17**. Existing standalone folders do not update automatically.

| Capability | Current state |
| --- | --- |
| Schedule, board, directory, requests and fairness | Working in one browser |
| Ask lookups, comparisons and single-person thresholds | Working for supported wording, with visible interpretations and source links |
| Document library | Pasted text and text files; matching passages, without validated clinical interpretation |
| Dedicated Protocols section and complete protocol answers | Planned; [invented-protocol build brief](docs/PROTOCOL-MILESTONE-1.md) |
| Shared storage, permissions and passkey operations | Server implemented and tested; sign-in screens and connected shared UI remain outstanding |

The next rollout is a private pilot in the owner's department: one department workspace, one personal account per member, a shared feed and conversations, with feedback from coworkers. Cross-department switching and other jobs are outside scope. The owner plans to fund hosting. This is direction for the next stage; the current local build remains a one-browser prototype. See [the shared pilot plan](docs/SERVER.md) for the preparation and launch checks.

## Try the public demo

Open the GitHub Pages deployment. Choose **Import schedule** and **Read 10 sample screenshots**. Review and publish the 217 extracted assignments. Select **Weekend** and tap one of your shifts to start a trade or coverage request. Use **Viewing as** to simulate the recipient and respond. All demo interactions are stored in that browser.

## Import photos locally

Use the prebuilt local release and run `python3 serve.py` from its extracted directory, with no port number. It opens the app in your browser and replaces an older copy that is still running. The workspace is kept in that one browser at that one address, so a different browser or a different port starts with sample names. The app shows where it is saving, and **Backup and restore** saves the whole workspace to a file and loads it back. Choose **Import schedule**, select or drop the images together, review the flags, then publish. Keep the same browser profile and URL to reopen the local workspace.

Current layouts are date rows with full dates and Day and Night columns with slash, semicolon, or pipe separators between people, employee rows with full dates as column headers and D or N codes, and a photographed paper calendar with a weekday header, short dates such as 11/29, and names in capitals under each date. For the calendar the app works out the year from the weekdays, guesses whether the page is days or nights and lets you switch it, reads pink and green highlighter as charge and ICU, keeps partial hours such as 7-3, ignores handwriting, and flags any cell where a printed name is crossed out. Use PNG or clear phone screenshots for best results. A layout with abbreviated dates, merged cells, or other shift codes may need an adapter. Check the date span and staffing counts before using an import. The app retains screenshots in that browser so you can trace a recognized cell to its source.

The same import reads a photographed department telephone list. Its table lines are removed and the page is read twice in two different ways. A number is accepted only when both readings agree on every digit, and everything else is shaded for you to check against a strip of the photo. Saved contacts appear in the Directory with Call and Text links that hand off to the phone or Messages app. Names on the schedule are matched to people on the list, and the list's sections fill in each person's employment status. Telephone numbers stay in the browser's storage on that device. They are not written to receipts, and nothing real belongs in this repository.

Every shift on the schedule has **Edit names**. It opens one line per person, with role and partial hours. A line that holds several names is split, a name entered twice is kept once, and the app says what it changed. The import review uses the same lines. An import that has been read but not published is kept if the page is closed, and is offered again next time.

The Department board takes pictures, files, video and audio. Video and audio play in the feed, a YouTube or Vimeo link plays after a tap, and a post can be marked as Learning. **Voice message to everyone** records, plays back and posts in three taps. **Share** hands a post and its files to the phone's share sheet, or offers copy, email, text and download. Posts and files are kept in the browser for now. `docs/SERVER.md` describes the shared version and what switching it on involves.

The Fairness tab is a kept record of who carried what. Everyone sees their own sheet, with their shifts, weekend turns against their share, holidays, charge and ICU turns, the trades they accepted, the shifts they covered and the times they went home in place of someone else, plus the department picture without names. Whoever keeps the record, set in Staff details, also sees who is carrying more than their share, a holiday tracker and the low-census ledger, chooses which holidays count, and can export the record. A published schedule stays on record when the next one replaces it. A low-census release is recorded from the shift itself. A shift that lists more people than usual is marked on the schedule, with who is next for a release: fewest hours lost goes first, and people who are level are shown as tied. Someone on a weekend-only position, or taking extra weekends by choice, is set in Staff details. Their weekend shifts come out of the rotation so that nobody else is measured against them, and extra weekends taken by choice are shown as credit. Calling in sick and declined requests are never counted, and nothing in the app rates a person.

The first release uses an illustrative Indianapolis department profile with day and night shifts. Eligibility based on a photo import remains provisional until current hours and staff attributes can be checked. A request can reach both agreed and queued for review. Official roster edits and real coworker notifications require an authorized shared deployment and integration.

**Ask**, in the header on every screen, looks up supported questions in the workspace's own records: when someone works, who is on, what is new on the board, what is due, how to reach someone, and matching passages in added documents. It reads shorthand and near-spellings, shows its interpretation, and retains the person/date/shift in short follow-ups. Answers name and open their sources. It uses question patterns and text matching, with no language model; unfamiliar wording can miss a record. Ambiguous staff names require clarification. Nothing is sent to an AI service.

Ask can rank or compare recorded figures and answer “who has more weekend day shifts than Casey,” showing Casey's figure as the reference. Named figures about other people remain restricted to the custodian. Thresholds currently support one strict person reference; negated and compound boundaries receive a clarification. See [the planner](docs/ASK-PLANNER.md) and [Version 17 notes](docs/RELEASE-17.md).

**Protocols are a central purpose of the product.** The intended section will browse the same versioned sources Ask uses and return the applicable rule together with its conditions, prerequisites, exceptions and escalation route. Today's paragraph search does not establish that completeness. [The protocol direction](docs/PROTOCOLS.md) and [first milestone brief](docs/PROTOCOL-MILESTONE-1.md) describe what remains to build, using an invented source before real documents. Real employer documents belong outside the repository, tests and public demo.

A notice on each screen and sheet says this is an independent staff project, not an official hospital product, and prohibits patient information. The first-use notice requires acknowledgement. A limited text screen stops writing that points to a particular patient (a record number, a birth date, a Social Security number, an age written the clinical way, a patient with a room, bed or name) and shows the words that set it off; pressing again does not override it. A word on its own is not a stop: reminders such as "check the date of birth", telephone numbers, and labelled order, part or badge numbers are saved. It misses anything written another way. Media and uploaded document contents are not inspected. Hashing does not prevent disclosure, encrypt content or establish hospital approval.

**Learning** is explicit relevance feedback, not policy approval. After opening a passage, **Yes, remember this wording** saves search words bound to that exact source version. A custodian can save human-written notes and their sources; stale linked notes stop matching, and notes cannot override live roster answers or restricted fairness lookups. Routine questions remain transient. Sending a question first opens a review that explains its words will be saved in the workspace and backups. Taught-note wording is saved only through the labelled learning action.

**Activity log** checks receipt links and hashes, and separately checks retained posts, files and documents against their recorded fingerprints. Large files use a SHA-256 chunk-manifest fingerprint covering every byte. Older items and unavailable media are reported as unverified or unavailable. A complete fingerprint saved independently can expose tail deletion or history replacement. These are local, unsigned receipts using the selected profile and device clock, not authenticated identities or active monitoring.

New receipts cover changes, agreements, saved corrections, rule changes and export requests. Opening a shift, post, document or Ask answer creates no named browsing receipt, question fingerprint or source-access record. Navigation retains button totals separately from the workspace; the board's last-seen position stays on the device for unread answers. Earlier browsing receipts remain unchanged so old checkpoints still verify. Backups and receipt exports include their own export-request receipt, which records a request rather than proof that a download completed. The updated notice is shown again once on each device.

**Version 14 identifies the build.** The footer shows the version and the first 12 characters of a generated SHA-256 build fingerprint. Workspace data shows the full fingerprint and mode. Every new receipt carries that identity inside its hash-covered payload; older receipts remain unchanged. The fingerprint covers the generated code, styles, HTML and public assets, with only the HTML's fingerprint value blanked to avoid hashing itself. `build-info.json` lists the covered file digests; `node scripts/check-build.mjs` verifies both build folders. Identical artifacts produce the same identity; any covered-byte or mode change produces a different one. Development mode has no release fingerprint and is labelled accordingly. This identifies build bytes, not an authenticated publisher or a person.

Text-screen stops also increment one anonymous local counter, visible under **Backup and restore**. No blocked text, profile, record or individual timestamp is kept. Repeated attempts and false alarms count as stops; the total is not a confirmed-disclosure count. It is reset with the other usage counts, excluded from backups and disabled in the public demo.

**Find ways off this shift**, on any of your own shifts, works out who could pick it up, which swaps pass, and which three-person exchanges pass, under rules the record keeper can set (pay-week start, weekly hours, rest between shifts). Each option states what it does to everyone's weekly hours. An exchange needs every person in it to agree and is rechecked each time. Ask answers "who can take my Friday night" and "can I pick up Saturday" with the same arithmetic. None of it knows who is willing or on leave.

**Corrections.** Every answer says, in plain words, what the question was taken to be. After **No**, the person says what was wrong: it misread the question, it quoted the wrong part of a document, or the schedule itself is wrong. A schedule error is corrected in the schedule, and a document error in the document. A misread or a wrong passage goes to the record keeper with how Ask understood it, and the keeper can save a reviewed correction: the same question in words Ask reads correctly, or the passage it should quote. A reading correction is worked out from the records each time, covers the same question about another person or day, and cannot add a person or a date the question did not have. A chosen passage holds only for that question and only until its document changes. A note is offered only when nothing else answers, and never comes before the schedule or a document.

Version 13 adds those corrections, the narrower text screen, and more ordinary schedule questions: who has no shift listed, shifts in a row, the last shift worked, what is left this month, the next weekend off, who is marked charge or ICU, which holidays a person works, and shifts shared with a named coworker. A date the schedule on record does not cover is reported as unknown.

When Ask recognizes separate dates joined in a schedule question, a prominent **Partial answer** notice names the dates asked about and the scope actually used. It still performs one lookup. This disclosure does not detect every compound question or measure uncertainty. The next shared-pilot milestone is authenticated accounts and cross-device records and messaging; broader Ask changes should be guided by questions from coworkers.

For a named weekday, **this** means the current Sunday–Saturday calendar week and **next** means the following calendar week. A bare weekday means its next occurrence, including today. Ask prints the actual date it used. An explicit week in a trade question stays fixed even when the person has no shift on that date.

Version 12 prefers swaps and three-person loops that preserve everyone's weekly hours, before changes between weeks and cover that loses hours. Pending exchange agreements are bound to the proposed assignments, participating rosters, recorded qualifications and rules. If these change, make a new proposal; earlier pending proposals without that binding also need to be proposed again. Started shifts are excluded. Ask reads month/week ranges and explicit years; hours include agreed changes and the configured pay-week boundary. Days off mean no listed shift on a recorded date, with missing dates reported separately. None of these checks establishes that the printed roster is complete or that a person is available or currently credentialed.

Controls are sized for phones: 60 px for a main action, 48 px for any other control and 16 px text, with an **Aa** button for larger text. `docs/USER-TEST.md` is a one-page sheet for watching coworkers try five tasks.

## Work on the source

Use Node 24 to match CI. Normal builds use the checked-in fictional fixture files and need no Python, Pillow or fonts. Python 3 is needed only to run the standalone launcher and its tests. Deliberately regenerating fixtures with `npm run fixtures:regenerate` additionally requires Pillow and DejaVu Sans; review and commit those changed files before a release.

```sh
npm ci
npm test
npm run build
npm run build:demo
npm run dev
```

For simulated interface checks, run `npm run build`, install `jsdom@26.1.0` into a temporary directory and run `scripts/check-ask-ui.cjs` with its `node_modules` on `NODE_PATH`. This uses fictional data and the production bundle; it does not test a real browser, microphone or physical phone.

Protocols have their own checks. `npm run gate:protocols` runs the protocol contract, then breaks the source one way at a time in a throwaway copy and requires the matching check to fail. `scripts/check-protocols-ui.cjs` checks the Protocols screens in the built release the same way `scripts/check-ask-ui.cjs` checks Ask, with jsdom on `NODE_PATH`. `node scripts/walk-protocols.cjs dist` walks the feature in a real browser and needs Playwright with Chromium; it is the only check that draws a PDF page and is not part of CI. Everything protocol-related in the repository is one invented document labelled "Synthetic test material — NOT FOR CLINICAL USE". What was built, what was checked and what it cannot do are in [the milestone report](docs/PROTOCOL-MILESTONE-1-REPORT.md).

Shared deployment has a separate access-boundary gate. `npm run gate:shared` starts the real server, seeds a fresh synthetic fixture and runs the contract in one command; `npm run test:shared` runs it against a fixture you supply. Both are described in `docs/SHARED-CONTRACT.md`. It requires a real isolated backend and fresh authenticated synthetic fixtures. With no backend configured it exits nonzero as blocked; the local test suite passing does not establish shared permissions. Cross-department denial, private conversations/files, restricted fairness and immediate revocation are required before shared rollout, alongside successful access controls.

Shared sign-in is a passkey, now implemented on the server and in no screen of the app: no email address is typed at sign-in and there is no Department Hub password. Members enter their own phone number and email address as their own information; what that email is for is an open question, recorded in `docs/EMAIL-OPTIONS.md` without a decision, and no sending mechanism is built. `docs/SIGN-IN.md` describes personal invitations and passkeys unlocked with the device's existing Face ID/fingerprint/PIN. The server operations exist; their app screens and physical-phone validation remain outstanding. Contact numbers remain optional and sharing defaults off; the backend contract tests both explicitly withheld numbers and immediate withdrawal across directory, search, Ask and exports.

An exported receipt history can be checked independently with `node scripts/verify-receipts.mjs EXPORT.json FULL_CHECKPOINT_HASH`. The optional checkpoint must come from a separately retained trusted copy. Without one, the check establishes internal consistency only. It does not authenticate a person, establish a trusted time or prove factual correctness.

The normal build creates `dist/`. The public demo build creates `dist-demo/` and disables the private file input. The GitHub Actions workflow builds and deploys only `dist-demo/`. Set the repository's Pages source to GitHub Actions. Source and demo fixtures are synthetic. Keep employer screenshots and all private imports out of Git, issue attachments, and Pages.

Version 17 extends the Version 16 planner with reviewed threshold handling and records the protocol milestone; see [the current release notes](docs/RELEASE-17.md) and [the Version 16 foundation](docs/RELEASE-16.md). The app still uses browser storage: no sign-in screen or shared UI is connected yet. The footer shows the source commit beside the artifact fingerprint and carries both in new receipts and `build-info.json`. A modified checkout is labelled **modified**; a build without its Git repository says **source unknown**. The source commit identifies the code revision. The fingerprint identifies the exact built files and mode. Local and demo are intentionally different modes and need not share a fingerprint. Fixed fixture inputs remove font/Pillow rendering differences from normal builds; matching other build tools and dependencies still matters for byte-for-byte reproduction.

To update an existing standalone folder, run this from the maintained source checkout:

```sh
npm run build
node scripts/install-local.mjs --target "$HOME/Downloads/Department-Hub-5"
```

The installer verifies the build, stages a complete copy, and renames the previous `app/` to an `app-before-update-…` sibling before activating the new copy. It never overlays old assets or deletes the old directory. Files outside `app/`, an existing `serve.py`, and browser storage are preserved. The installed `app/` can be checked with `node scripts/check-build.mjs "$HOME/Downloads/Department-Hub-5/app"`. Keep the same browser and address to reuse the workspace.

OCR runs in a browser worker. The worker, core binaries, and English data are bundled and served from the same origin. The local release has no OCR service to configure. Stencil, Blinders, and Deflate are optional external tools and the import path has no dependency on them.

## Decision records

Schedule publications, request creation, and responses generate local hash-linked receipts. Exports contain staff names. Keep them within the authorized review group. A local owner can replace a whole history. A shared deployment will need authenticated identities, a versioned official roster feed, and an independently retained audit checkpoint.

GitHub Pages deployment guidance is available in the [GitHub documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site). The OCR setup follows the [Tesseract.js local installation guide](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md).
