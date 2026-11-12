# Reference knowledge: answers in the source's own words, borne out by pictures of the page

Branch `claude/reference-witness`, on top of `main` at `242e282`. Written 2026-11-12.

## What this is

The owner needs Ask to answer technical questions with the figure, not with a link. Most such questions are not
about one hospital's protocol at all: a normal range, a definition, how a result is read. That is general reference
knowledge, and it has its own layer.

A **reference card** is a title, the wordings a question might use, and passages of a captured source page. It holds
no sentence of its own. Ask answers with the passages exactly as captured, and under each one a picture: the
screenshot of the page, cropped to where that passage was found, each found line outlined. Every answer says it is
reference knowledge, not the hospital's protocol and not an order for any patient.

There are four kinds of source, strongest first: a held hospital protocol (the original file, reviewed answers);
a reference card (a captured page, borne out by its screenshots); a pasted document (searched text); a professional
reference (a link only). A held protocol always answers first.

## Why the cards no longer have a person check them

The earlier cards each carried a sentence written by an AI assistant, and a person compared that sentence with the
page before it could answer. The owner did not want to be the link that vouches for an AI's paraphrase. The answer to
that was not a better check of the paraphrase; it was to remove the paraphrase. With nothing reworded there is nothing
to compare for meaning, and what is left to check is custody: that the text shown is the text that was on the page.
That the app checks by itself, against pictures of the page.

## How the page got here

The owner's capture tool, Blinders, saved from his own Chrome on 2026-11-12:

| | Capture | Bytes | SHA-256 |
| --- | --- | --- | --- |
| The chapter's rendered text (14:55 UTC) | `cef48181-…cdcf95` | 25,965 | `cf48652c…cde3e7` |
| The page's licence line (14:55 UTC) | `b0473561-…7a62` | 163 | `bb75fe52…ccc495` |
| Seven screenshots of the visible page (16:23–16:25 UTC) | `a750f9ff`, `38b08e04`, `9a04d9b2`, `49343fa5`, `06179dd5`, `5fd1d205`, `d433e7a5` | 238,546–459,096 each | in each receipt |

All were taken through Blinders' bridge. For the screenshots, the paired tab was moved to each cited part of the page
by a link to an anchor or to words on the page; Chrome marks words reached that way in purple, and the marks are in the
pictures. Each screenshot is 2812 × 1540 pixels, the screen at twice its scale. They were moved from the Blinders inbox
to this repository through the Claude app's browser and re-hashed on arrival; every one matched its receipt. They are
held in `src/reference/sources/` with Blinders' receipts beside them, as binary files Git will not alter.

A receipt is a row in a local database with no signature. It shows which bytes were saved and when, not that no one
changed the database since. The page is licensed CC BY 4.0, which permits holding and showing its text and pictures
with credit; the licence line is shown with the cards.

## What the app checks when the cards are added, and no person does

Adding the cards runs on the device, in the browser, and takes about 45 seconds:

1. The held text, licence line and all seven screenshots hash to the SHA-256 and byte count in their receipts.
2. Every passage a card cites is a run of lines that exists in the held text.
3. The app's own text reader (the bundled Tesseract already used for schedule photos) reads each screenshot three
   ways: as a page, as one block, and as scattered words. Each line of every cited passage must be found in one of
   those readings: its words in order, laid out together (a table row's cells side by side, a paragraph's lines
   stacked in one column), **every number exactly as captured**, and no clearly read word on the screen where the
   text has a different one. A word the reader could not make out may be missing; most passages lose none, the worst
   line loses one in eight.

If any card fails, none is added, and the refusal says which and why. Across the twelve cards, 1,091 of 1,100 words
were found, every number. The check is sealed onto each card with its passages and receipts; editing any of them in
storage afterwards stops that card answering.

### What it was tested against

The witness was built against what can go wrong, and each of these was tried as a change to the held text with its
receipt recomputed to match, so that only the screenshots stood in the way. All fourteen are refused: a critical value
swapped for its neighbouring row's (PaCO2 25 → 60, PaO2 60 → 25); a critical high moved to the normal range's top
(60 → 45); the pH range and its critical low swapped; SaO2 88 → 95; HCO3 10 → 22; `>45` → `>35`; `<7.35` → `>7.35`;
"acidotic" → "alkalotic"; "kidneys" → "lungs"; "decreases" → "increases"; "both out of range" → "or … is out of range";
"not both" → "both"; an added number. Swapping one screenshot's reading for another's is refused too. Eleven
deliberate breaks of the checking code were each caught by a test; one (ignoring a missing number) was missed at
first, and the added-number case was written to catch it.

### What it cannot check

**Which passage a question wants.** "Normal PaCO2" reaches the PaCO2 card because the card lists that wording. That
matching is the app's, it can be wrong, and the answer always shows the source's own text so a reader sees what it is
answering with. The tests hold the expected card for each of a set of questions.

**A word the reader cannot see.** The reader does not reliably read subscripted chemical names or white text on the
table's blue header. A table row's label (a lone "SaO2") may be counted as missed rather than read. A label holding a
number is never skipped. In the screenshots the unread words are there to see.

**The live page now.** The cards rest on the capture. The live page may have changed since; the app says so.

**What the textbook gets right.** Its critical values are credited, in its own note [2], to one laboratory's 2016
list (WakeMed Pathology Laboratories), and the cards show that note. A department's own laboratory sets its own.

## The cards

Twelve, from *Nursing Fundamentals 2e*, section 15.5 "Acid-Base Balance", WisTech Open (Open RN), 2024: adult normal
values; pH, PaO2, PaCO2, HCO3 and SaO2 each with their critical values; the critical values together; acidosis or
alkalosis from the pH; respiratory and metabolic acidosis and alkalosis; compensation; what the lungs and kidneys
manage. The SaO2 card answers arterial-saturation questions only; "normal SpO2" gets no card.

Adding them withdraws the earlier sets (the AI-reading set and the person-checked set), with the reason recorded.
Those no longer answer in any case.

## Checks

| Check | Result |
| --- | --- |
| `npm test` | 256 pass, 11 of them for the cards |
| `npm run test:server` | 78 pass |
| `npm run eval:ask` | 0 confidently wrong; unchanged |
| `npm run gate:protocols` | 16 of 16 faults caught |
| `scripts/check-protocols-ui.cjs` (CI) | Passes; the reader's recorded output stands in for the reader, which jsdom cannot run |
| Browser walk, `dist` and `dist-demo` | 17 steps pass on each; the cards step runs the real reader in Chromium (about 45 s) and finds the same 1,091 of 1,100 words |
| Builds | Both verify, 64 files each; the seven screenshots add 2.2 MB, loaded only when cards are shown |

`scripts/read-capture-shots.cjs` records the reader's output for the Node tests, in a real browser with the app's
own reader. Rerun it if the screenshots or the reader change.
