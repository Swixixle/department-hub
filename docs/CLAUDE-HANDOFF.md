# Department Hub handoff for Claude

This handoff lets Claude continue development from the existing repository. The owner requested continuity after running out of usage in the previous assistant. The project source and this handoff are the durable context.

## Open these first

- Repository https://github.com/Swixixle/department-hub
- Fictional demo https://swixixle.github.io/department-hub/
- Project instructions `CLAUDE.md`
- Setup and build commands `README.md`

The application baseline was commit `f11593066e63afc6cab2c98e4565afe10cf2332a`. Check the current branch and HEAD when starting. This handoff is being added after that baseline.

The repository is owned by the user's GitHub account. Claude Code can clone public source. To push branches or publish changes, use the owner's own authorized GitHub connection or normal local authentication. The owner's account authorization happens in Claude or GitHub. No assistant login or browser session is included in this handoff.

## The owner's intended product

A private, interactive, almost social workspace for a department. It should simplify everyday coordination. The respiratory department is the initial example, with a schedule, a small department board, and discussions attached to requests. The owner liked the current look.

The product should feel complete enough to show coworkers. Keep the main experience small and connected. A coworker should be able to open the schedule, tap a shift, find a trade or coverage candidate, and discuss that request in place. Batch photo import is a core entry point.

Most early discussions are considerations. The owner explicitly said nothing is locked. Seniority weighting, permanent day-shift waitlists, holiday rotation rules, how voluntary low-census cuts affect future mandatory cuts, PRN eligibility for coverage, overtime routing, and approval procedures all need deliberate decisions. Treat the starter rules in code as illustrative values with a version, rather than settled employer policy.

### Essential photo flow

The owner expects to select roughly ten separate screenshots of staffing schedule pages, have the app read and combine them into its own calendar, review the flagged cells, and then use the roster. Retain access to each source photo so a mistaken assignment can be checked quickly. Clear, supported pages should save the user from retyping or checking every cell.

Keep the import draft intact through the review. Detect overlapping pages, ambiguous dates, doubtful names or codes, gaps, and conflicting assignments. Show the recognized date span. Once real photos arrive, adapt to that actual layout and verify the output against the images. A successful synthetic batch leaves real-layout accuracy unverified.

### Schedule interaction

The schedule offers two actions.

- Trade this shift finds coworkers and specific shifts they could trade back. The initial prototype excludes PRN trades and projected overtime trades.
- Find coverage asks someone to take the shift outright. The prototype permits PRNs for coverage and excludes projected overtime. Those are provisional defaults and are a separate choice from trade rules.

Recheck both participants' eligibility when accepting a request. Keep the source shifts, the proposed change, the rules applied, the current roster revision, the discussion, and the response. Current flow ends at `Both agreed · queued for review`. Whether all trades need approval or only certain trades remains a department and official-system question.

### Weekends and payroll boundaries

The owner emphasized weekend shifts. Keep a Friday-through-Sunday view. Display an overnight shift on its start date, while calculating elapsed hours and workweek boundaries separately. A Saturday 19:00 to Sunday 07:00 shift normally contributes five clock hours to the ending Sunday-through-Saturday week and seven to the new week, before unpaid time and with clock changes handled explicitly.

The initial department example is four people on days and three on nights, 12-hour shifts, three shifts a week per full-time person. Those headcounts are illustrative targets until the department defines its actual staffing matrix. Track different staff qualifications and the remaining coverage after a proposed change. Current eligibility modeling is much simpler than a production staffing matrix.

## Current implementation

| Component | Current behavior |
| --- | --- |
| Frontend | Vanilla JavaScript modules, Vite, CSS, responsive layout |
| Schedule | Week and weekend views, staff selection, shift detail dialogs |
| Import | Multiple PNG, JPEG, or WebP files, up to 20 files and 20 MiB per file |
| OCR | Tesseract.js 7 with same-origin bundled worker, WASM core, and English data |
| Parsing | Full-date rows with Day/Night columns, or employee grids with full-date headers and D/N codes |
| Names in date rows | Slash, semicolon, and pipe separators |
| Evidence | SHA-256 of source bytes and recognized-cell bounding boxes, photo preview on a shift |
| Import review | Flags, corrections, duplicate assignment merge, staffing and overlap issues |
| Local storage | Structured app state in localStorage, source images in IndexedDB |
| Trade and coverage | Roster-based matching, sample staff attributes, discussion and response |
| Board | Local posts in the current browser workspace |
| Receipts | Local hash-linked publication, request, profile, and response events |
| Demo | Public GitHub Pages, fictional roster and fictional sample image batch |
| Local build | Private file input and on-device OCR, launched from a local loopback server |
| Deployment | GitHub Actions builds `dist-demo/` and deploys to Pages |

The UI's `Viewing as` selector simulates the recipient. It is a demonstration control. A shared deployment needs authenticated identities and server-side authorization. Board posts and request messages currently stay in the same browser. They are not sent to another coworker's device.

Real imports begin with unverified staff status, qualifications, and actual hours. A local Staff details screen can record known attributes, but the import remains a snapshot. Official pickups, missed meals, overtime approval, and later changes require a current authorized source or explicit verification.

The implementation has no native iOS or Android project yet. Capacitor was discussed as the route to keep one web codebase and package both platforms. Stencil, Blinders, and Deflate were discussed as possible helpers, and the shipped import pipeline is independent of them.

## Source map

- `src/main.js` owns the UI and workflows.
- `src/model.js` owns the starter policy, name and assignment keys, time calculations, deduplication, roster checks, and eligibility.
- `src/importer.js` owns browser OCR, source hashing, page layout parsing, flags, and batch import.
- `src/storage.js` owns source-image IndexedDB operations and local state persistence.
- `src/style.css` owns the visual layout.
- `scripts/prepare-assets.mjs` copies locked OCR assets and checks for versioned fixture inputs.
- `scripts/make-fixtures.py` generates ten overlapping fictional schedule screenshots and the expected 217-assignment truth set.
- `scripts/serve.py` is copied to the standalone release root and serves the adjacent `app/` directory on loopback.
- `tests/model.test.js` contains seven existing regression checks.
- `.github/workflows/pages.yml` builds and publishes the fictional demo.

Generated `public/ocr/`, `dist/`, and `dist-demo/` are ignored and recreated by the build. Fictional `public/fixtures/` images and truth manifests are checked in and reused byte-for-byte. Regeneration is a deliberate maintenance action, not a normal build step.

## Setup

Use Node 24 to match GitHub Actions. Normal builds need no Python, Pillow or fonts. Python 3 is required for the standalone launcher and launcher tests. Deliberate fixture regeneration needs Pillow and DejaVu Sans; review and commit the resulting files before releasing them.

```sh
git clone https://github.com/Swixixle/department-hub.git
cd department-hub
npm ci
npm test
npm run build
npm run build:demo
npm run dev
```

The normal build is `dist/`, and the public demo is `dist-demo/`. The relative Vite base supports the GitHub Pages repository path. Test both outputs when changing asset paths or import handling. Version 15 records the actual Git commit and modified/unknown source status alongside the per-mode artifact fingerprint. To update a standalone folder without accumulating obsolete scripts, use `node scripts/install-local.mjs --target PATH_TO_STANDALONE_FOLDER` after building. It keeps the complete old `app/` as a sibling backup; do not copy over the old assets directory.

The downloadable local release already supplied to the owner is `Department-Hub-Local.zip`. It contains a prebuilt `app/` directory and a root-level `serve.py`. After extraction, `python3 serve.py` opens a loopback server at `http://127.0.0.1:8769`. Keep the same origin and browser profile to reuse its stored data. The release ZIP is a build artifact. Its source is this repository.

## Verified at the original build checkpoint

These are historical observations to reproduce when relevant.

- Seven Node tests passed. They cover Saturday-night workweek splitting, the fall clock change, evidence-preserving duplicate merge, a trade with unverified hours, PRN exclusion for trades, projected overtime on an extra shift, date validation, and a doubtful OCR cell. Several assertions share a test.
- The normal and public demo production builds passed.
- Actual Tesseract.js recognized the ten generated screenshots, producing exactly the 217 expected unique assignments, without missing or additional assignments and with zero flagged cells for that fixture.
- The public Pages build completed successfully in GitHub Actions.
- In Chrome, the public app read the ten fixture images, showed 217 assignments and zero review items, published the roster, and displayed the source image for a selected shift.
- A fictional trade from Jordan to Quinn progressed to agreement queued for review.
- The board and coverage finder were opened in the live demo.
- The standalone ZIP was unpacked and its launcher served the app and OCR worker from loopback.

The real schedule layout, physical iPhone and Android behavior, native packaging, shared accounts, cross-device messages, push notifications, and official roster sync remain unverified or unimplemented. The earlier local headless Chromium test could not start because of the execution environment. The deployed app was instead exercised through the connected Chrome browser.

## Review points before real department use

These are concrete implementation limitations, rather than settled new feature requirements.

1. Layout coverage is narrow. Abbreviated dates, yearless grids, merged cells, shift colors, and unfamiliar codes can require a layout adapter. A recognized cell's confidence does not prove every source cell was found.
2. Publishing replaces the current roster. Review partial imports, flagged-page dismissal, staffing issues, and the handling of existing requests before relying on a new snapshot.
3. The current eligibility evaluator can return review early when staff attributes are unknown. Audit that known overlaps and overtime conflicts still surface when other inputs are uncertain.
4. Match lists are limited to 40 candidates and use simple shift skills. Production coverage, availability, rest rules, employment statuses, and concurrent requests need a fuller model.
5. Local receipts can detect edits within a retained chain. A local owner can replace the whole chain. Stronger evidence requires a separately retained checkpoint and access controls.
6. Browser state has no authenticated department membership and no cross-device service. A real social workspace needs private persistence, membership, per-user permissions, and conflict handling.
7. The UI and rules need physical-phone checks for file picking, image rotation and scale, worker/WASM loading, memory use, persistence, and responsive dialogs.

## Sensible next work

Start with the owner's current request in the new Claude conversation. The latest topic was iPhone and Android packaging.

A bounded mobile continuation can add Capacitor configuration and platform scaffolding against the existing local build, then verify asset loading and storage in each native runtime. Use the native photo picker where appropriate, keep OCR assets bundled, and test the same ten-image batch. Signed iOS builds need the owner's Apple account and a Mac/Xcode environment. Android distribution needs the owner's chosen build and signing setup. Ask for account-side steps only when the work reaches them.

When approved real schedule photos arrive, reproduce their layout with synthetic or redacted fixtures and adapt parsing. Report the supported format and any unresolved cells accurately. Keep the first upload flow short.

For shared department use, build an authenticated private service and real cross-device request workflow as a separate explicit stage. GitHub Pages continues serving the fictional demo. Routine edits to main trigger the existing Pages workflow.

## Data and tool boundaries

The public repository and demo contain fictional data. Keep employer policy documents, real schedule images, staff records, private messages, and credentials in authorized private locations. One internal organizational AI-use restriction was encountered during earlier research. The owner should confirm an approved processing route before internal documents are sent to an external model provider. Local OCR does not establish organizational approval on its own.

Claude can use the public source immediately and use the owner's GitHub authorization for writes. The owner's ChatGPT login, local browser database, hospital session, and other application sessions stay with their respective accounts and devices. Use normal sign-in on the destination service when a task requires access.

The owner values autonomy, straightforward explanations, and concrete working results. Keep the familiar interface, simplify the primary flows, and mark assumptions that affect eligibility or import correctness. Carry each selected task through relevant tests and a reviewable commit or pull request.
