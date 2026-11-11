# Department Hub

A small department workspace with a roster, a department board, and conversations attached to trade and coverage requests. The public demo uses fictional data. The standalone local build accepts PNG, JPEG, and WebP screenshots.

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

**Ask**, in the header on every screen, looks up supported questions in the workspace's own records: when someone works, who is on, what is new on the board, what is due, how to reach someone, and matching passages in added documents. Answers name and open their sources. It uses question patterns and text matching, with no language model; unfamiliar wording can miss a record. Nothing typed into it leaves the device.

Controls are sized for phones: 60 px for a main action, 48 px for any other control and 16 px text, with an **Aa** button for larger text. `docs/USER-TEST.md` is a one-page sheet for watching coworkers try five tasks.

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
