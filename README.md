# Department Hub

A small department workspace with a roster, a department board, and conversations attached to trade and coverage requests. The public demo uses fictional data. The standalone local build accepts PNG, JPEG, and WebP screenshots.

## Try the public demo

Open the GitHub Pages deployment. Choose **Import schedule** and **Read 10 sample screenshots**. Review and publish the 217 extracted assignments. Select **Weekend** and tap one of your shifts to start a trade or coverage request. Use **Viewing as** to simulate the recipient and respond. All demo interactions are stored in that browser.

## Import photos locally

Use the prebuilt local release and run `python3 serve.py` from its extracted directory. Open the printed loopback URL in a normal browser. Choose **Import schedule**, select or drop the images together, review the flags, then publish. Keep the same browser profile and URL to reopen the local workspace.

Current layouts are date rows with full dates and Day and Night columns with slash, semicolon, or pipe separators between people, and employee rows with full dates as column headers and D or N codes. Use PNG or clear phone screenshots for best results. A layout with abbreviated dates, merged cells, or other shift codes may need an adapter. Check the date span and staffing counts before using an import. The app retains screenshots in that browser so you can trace a recognized cell to its source.

The first release uses an illustrative Indianapolis department profile with day and night shifts. Eligibility based on a photo import remains provisional until current hours and staff attributes can be checked. A request can reach both agreed and queued for review. Official roster edits and real coworker notifications require an authorized shared deployment and integration.

## Work on the source

Use Node 22 or later and Python 3 with Pillow and DejaVu Sans installed.

```sh
npm ci
npm test
npm run build
npm run build:demo
npm run dev
```

The normal build creates `dist/`. The public demo build creates `dist-demo/` and disables the private file input. The GitHub Actions workflow builds and deploys only `dist-demo/`. Set the repository's Pages source to GitHub Actions. Source and demo fixtures are synthetic. Keep employer screenshots and all private imports out of Git, issue attachments, and Pages.

OCR runs in a browser worker. The worker, core binaries, and English data are bundled and served from the same origin. The local release has no OCR service to configure. Stencil, Blinders, and Deflate are optional external tools and the import path has no dependency on them.

## Decision records

Schedule publications, request creation, and responses generate local hash-linked receipts. Exports contain staff names. Keep them within the authorized review group. A local owner can replace a whole history. A shared deployment will need authenticated identities, a versioned official roster feed, and an independently retained audit checkpoint.

GitHub Pages deployment guidance is available in the [GitHub documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site). The OCR setup follows the [Tesseract.js local installation guide](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md).
