# Department Hub project instructions

Continue the existing Department Hub project for its owner. Read `docs/CLAUDE-HANDOFF.md` and `README.md` before making changes. The handoff captures the owner's product direction, implemented behavior, prior checks, and unfinished work.

## Product direction

Build a simple private department app around a schedule, a department board, and conversations attached to shift trades and coverage requests. Batch screenshot import is essential. Support the owner's respiratory department first while keeping department rules configurable in code. Preserve the current visual design and clear, short user flows. Most proposed scheduling policies remain open considerations.

## Working method

- Inspect the current branch, local changes, and source before editing. Extend the current implementation in small, reviewable steps.
- Make routine reversible implementation decisions and carry each authorized task through its normal entry points, relevant verification, and a clear result.
- Use `npm ci`, `npm test`, `npm run build`, and `npm run build:demo` as appropriate. Fixture generation needs Python 3 and Pillow. Node 24 matches CI.
- Maintain the distinction between the public fictional demo and the local photo-import build. Keep employer screenshots, employee data, private policies, credentials, and runtime exports outside the repository and Pages artifacts.
- Treat screenshot imports as dated snapshots. Keep uncertainty visible whenever hours, qualifications, or later pickups are unknown. Requests end at agreement queued for review until an authorized official-system workflow exists.
- Label current single-browser simulation clearly. Shared accounts, private messaging, notifications, native packages, and official roster integrations remain future work.
- Preserve source-image references and corrections. Local hash-linked receipts require independent checkpoints for stronger tamper evidence.
- Verify the real screenshot layout when the owner supplies an approved example. The synthetic batch establishes a regression baseline for two supported layouts.
- Keep Stencil, Blinders, and Deflate optional. The implemented importer uses bundled local Tesseract.js assets. Verify any proposed tool integration on the machine where it will run.

## Next work

Reproduce the baseline and follow the owner's next instruction. The most recent discussed technical step is preparing iPhone and Android packages with Capacitor and verifying the existing photo import on each platform. Real schedule images were still pending at the original build checkpoint. Keep layout adaptation and phone import usability ahead of expanding settings or unrelated features.
