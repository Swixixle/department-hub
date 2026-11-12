# Protocol milestone 1: what was built, what was checked, what it cannot do

Report for the brief in [PROTOCOL-MILESTONE-1.md](PROTOCOL-MILESTONE-1.md). Branch `claude/protocol-milestone-1`,
from main at `1906109`. Everything here was built and tested with one invented protocol. No real protocol has been
read by this code, nothing was deployed, the Mac installation was not touched, and no shared sign-in screen exists.

The tests show that stated behaviours hold for one made-up document. They are not a measure of accuracy on questions
nobody has seen, and they are not clinical validation of anything.

## What a person can do now

Open **Protocols** from the top bar on any screen. Add a protocol as a PDF with the details printed on it. The file is
read on the device into anchored passages, shown beside the drawn original. A record keeper confirms the reading,
adds a mapping of answers written for that exact file, reviews each answer against the original, and makes the
revision active. From then on Ask answers questions about it with the whole rule: a plain-language line, then every
linked passage in the protocol's own words (the rule, the order requirement, who may do it, when not to, when to stop,
who to call), each with the revision, page and file fingerprint, and each one tap from its outlined place in the
original. When the rule turns on something the question did not say, Ask asks, with "Not known" always offered; not
knowing returns every possibility whole. A later revision takes over on its effective date, the earlier one stays
readable as history, and nothing answers until the later one has been reviewed.

## The three commits

| Commit | What it holds |
| --- | --- |
| Hold a protocol as versioned originals with a checked reading | The invented PDFs and their generator, `src/pdftext.js`, `src/protocols.js`, expected readings, 16 tests |
| Answer a protocol question with one whole reviewed rule, or not at all | `src/bundles.js`, `src/pathways.js`, the hook in `src/ask.js`, the mappings, the contract, the fault runner, 27 tests |
| Add Protocols to the interface and hand Ask's citations to the original | `src/protocol-view.js`, `src/protocols.css`, the wiring in `src/main.js`, two interface checks, CI step |

The third commit also carries one change to `src/pathways.js` and a test for it. It belongs with the second in subject
and is in the third because the browser walk is what found it; see "What the checks found" below.

## Decisions the brief left open

These are mine. Each is a place a reviewer may reasonably disagree.

**A later revision supersedes from its effective date whatever state it has reached.** The brief lists "superseded"
as a state and also says revision 1 must not answer once revision 2 is in effect, even before revision 2 is reviewed.
Those only agree if supersession is worked out from dates rather than set by an action, so `standing()` and
`applicable()` derive it. The consequence: adding a mistaken file dated in the past silences the protocol until that
import is withdrawn. That is the safe direction, and withdrawal restores the earlier revision at once, with a receipt.

**Protocol text is never quoted outside a reviewed answer.** When no reviewed answer applies (pending review, no
mapping fits, the question is not covered) Ask gives the page and section and an Open button, and no passage text.
The brief allows search to "suggest a passage"; quoting the best-matching paragraph is exactly the failure the
milestone exists to prevent, because the paragraph that matches the question is rarely the one that forbids the act.
Pasted legacy documents keep their old quoted search results, now labelled as legacy.

**Mapped answers are written as a file, not in the app.** There is no screen for authoring a mapping. A mapping is
JSON naming, for each answer, its conditions and each passage by file digest, anchor and text hash; the app validates
it, shows every part of it beside the original, and records each review. Writing one by hand needs the anchors from
the Reading view. This is the largest missing piece for real use and is listed under limits.

**A summary may only state figures its linked passages state.** `figuresOf` reads each number with the word after it
("12 mk/min", "10 minutes"). A mapping whose summary gives a figure or unit that no linked passage gives is refused.
It forces the summary to copy units exactly, which also means a summary cannot say "12 marks per minute" where the
protocol says "12 mk/min".

**Only a record-keeper profile can add, confirm, review, activate or withdraw.** Everyone else can read, search,
bookmark and ask. Every review screen and receipt says the profile is selected on the device and is not verified.

**A question is taken as a protocol question only when it names the protocol.** It must contain a distinctive word of
the title, the identifier or a subject word from the mapping, together with a topic or condition word, or follow a
protocol answer in the same conversation. With a protocol held, every other question answers exactly as before; the
contract asserts that for five existing questions against the evaluation world.

**Bookmarks are stored in the workspace with no name attached, and write no receipt.** The version number is not
changed and no release notes are written; that is the integrator's step.

## What was checked

Run on Node 22.23 in the build sandbox, after the third commit.

| Check | Command | Result |
| --- | --- | --- |
| App tests | `npm test` | 236 pass (192 before; 16 source, 28 bundles and pathways) |
| Server tests | `npm run test:server` | 78 pass, unchanged |
| Shared permission gate | `npm run gate:shared` | 13 pass, unchanged |
| Schedule and threshold evaluation | `npm run eval:ask` | 63, 48 and 18 correct; 0 confidently wrong; unchanged |
| Builds | `npm run build`, `npm run build:demo`, `node scripts/check-build.mjs` | Both verify, 51 files each (44 before) |
| Existing interface check | `scripts/check-ask-ui.cjs` | Passes. Its workspace has no protocol library, so it is also an upgrade check |
| Protocol interface check | `scripts/check-protocols-ui.cjs` | Passes. Added to CI |
| Launcher | `python3 -m unittest tests/test_launcher.py` | Passes, unchanged |
| Protocol contract | `node tests/protocol-contract.mjs` | 21 checks pass |
| Deliberate faults | `npm run gate:protocols` | 16 of 16 caught; unbroken copy passes all 21 first |
| Browser walk, production build | `node scripts/walk-protocols.cjs dist` | 15 steps pass |
| Browser walk, demo build | `node scripts/walk-protocols.cjs dist-demo` | 15 steps pass |

`npm audit` reports the same two findings (one low, one high) before and after adding `pdfjs-dist`; neither is in it.

The browser walk needs Playwright with Chromium and is not in CI. It is the only check that runs the PDF reader and
its worker in a browser, draws pages, measures where the outline lands, uses a phone-sized window, upgrades a saved
workspace in place and swaps or removes a stored original. Until it runs somewhere automatic, those are checked only
when someone runs it.

### The contract and the faults

`tests/protocol-contract.mjs` asks questions through Ask's ordinary entry point and asserts the words returned and
the anchor, page and file digest of each passage. `scripts/protocol-faults.mjs` copies the source, breaks one thing,
runs the contract on the copy and requires the named check to fail. A fault whose target text has moved is an error,
not a pass. The five faults in the brief are each applied twice or more: as a wrongly written mapping that was
reviewed anyway, and as a defect in the code.

| Fault | How it is applied | Check that fails |
| --- | --- | --- |
| Remove the contraindication link | Mapping reviewed without it | contraindication |
| | Answers drop that kind of passage | contraindication |
| Alter a unit | Summary says mk/sec, guard removed | unit |
| | Guard alone removed | guard |
| | Summary says mk/sec, guard in place: mapping refused | control, unit |
| Select the wrong age branch | The two answers mapped to each other's band | age (pediatric question) |
| | The band said is ignored for the first choice | age (pediatric question) |
| | "Not known" taken as the first choice | age (not given) |
| Remove the order requirement | Mapping no longer asks about or links it | order |
| | An order not mentioned is taken as present | order |
| | An unknown order is taken as present | order |
| Reuse a superseded revision | Earliest revision in force is used | replacement (active) |
| | Falls back while the new one is unreviewed | replacement (pending) |
| | Mapping accepted for another file | replacement (mapping) |
| Answer from an unreviewed mapping | Review seal not compared | review |
| Answer before the effective date | Early activation answers at once | future date |

The first contract check is the positive control: a direct question must return the complete answer with all six
kinds of passage, seven citations and the versioned source line. An implementation that refuses everything fails it.

Twelve further mutations were applied by hand to the interface layer (a missing keeper check, "Yes" accepted on a
protocol answer, Open dropping the cited place, the outline on the wrong page, the legacy label dropped, a withdrawal
with no receipt, the stored file not checked against its fingerprint, search reading history, typed text written to
storage, and others). Eleven were caught. One was not: showing the review button to everyone. The press was already
refused, but nothing asserted the button was absent while answers were waiting. The interface check now does, and
catches it. Three of the eleven first reported a false catch, because my harness could not find the browser and I
counted its error as a failure of the check; rerun properly, the walk caught all three. That harness is not committed.

### What the checks found

Three defects of mine, each caught by a check and not by reading the code.

A block of form handlers was inserted into the click handler instead of the form handler. Every Node test passed,
because none of them loads `src/main.js`. The browser walk failed on search and on withdrawal. That is why a jsdom
check of the built release now runs in CI: without it the interface wiring has no automatic test at all.

A protocol held with nothing mapped to it yet was not recognised, so a question about it fell through to the schedule
lookup and got an unrelated answer. The contract only covered the case where an earlier revision's wording existed.
It is now recognised by two of its own title words (so "bellows drill" but not "fire drill"), with a test.

On a phone the revision's standing badge and the paragraph saying what the feature is for were hidden, because the
existing phone style hides paragraphs in page introductions. The screenshot showed it; no assertion did. Both are now
outside that rule and asserted visible.

## Measurements

Bundle, production build: the always-loaded script went from 227.8 kB to 293.3 kB (78.8 to 100.5 kB gzip). That
65 kB is this milestone's own code, which Ask needs on every question. The PDF reader is a separate chunk of 451.9 kB
(134.9 kB gzip) with a worker of 1,271.9 kB (378.1 kB gzip), fetched only when an original is opened or a PDF is
added. Both ship with the app; nothing is fetched from elsewhere.

Reading time, sandbox machine, not a phone:

| File | Where | Time |
| --- | --- | --- |
| Invented protocol, 3 pages | Node | about 120 ms first read, about 30 ms after |
| Invented long text file, 40 pages, 113,000 characters | Node | about 200 ms |
| Same 40 pages | Chromium, from pressing Add to the reading on screen | about 870 ms, of which 350 ms reading |
| Same 40 pages | Chromium, until all 40 pages are drawn | about 1,500 ms |

The 40-page file is running text generated for timing. It is not a protocol and is not committed. No measurement was
taken on a phone or in Safari.

## What it cannot do

The reader takes a PDF's text layer and nothing else. A scanned page reads as empty; the app says so, refuses to
confirm it, and lets a reviewer type the text in, labelled as typed. Tables are read only when each cell is one line
and the columns line up under a header row; a wrapped or merged cell will be read as separate rows or as paragraphs.
Text in two columns side by side is not put back in reading order. Headings are recognised by size alone. A diagram's
words are listed as labels and its arrows are not read; labels are suggested from a figure caption on a page with
drawing, and a diagram with no such caption has to be marked by hand before the reading is confirmed. Rotated text,
footnote marks and hyphenated line breaks are not handled. Each of these is caught only if the person comparing the
reading with the original catches it.

There is no in-app way to write a mapping. A rule can depend only on single-choice facts (adult or pediatric, order
or no order). It cannot depend on a number in a range, on two facts joined by "or", or on a calculation.

A question reaches a protocol only if it names it, and reaches one topic; a tie between topics is put back as a
choice. Near-miss spelling is corrected against the protocol's own words, which can turn an ordinary word into one of
them ("older" into "order"); the change is shown above the answer.

The library, readings included, is stored with the workspace in the browser's local storage. The 40-page reading is
180 kB, and browsers allow roughly 5 MB, so a few dozen long protocols will not fit. Readings should move beside the
original files before real use. Original files are not in a backup: after a restore on another device each original
has to be chosen again, and is accepted only if its fingerprint matches.

All of it is one browser. The shared server knows nothing about protocols. A review is recorded against whichever
profile is selected, with no proof of who that was. The effective date, issuer and identifier are typed by a person
and not checked against the file. The device cannot know whether the issuer has published something newer, and every
answer says so.

It has not been run on a real phone. Whether the reader's module worker loads in iOS Safari is untested.

The drawn page is an image to a screen reader; the reading beside it is the accessible text.

## A short walkthrough, with the invented protocol

1. Choose a record-keeper profile under "Viewing as". Press **Protocols**, then **Add the invented protocol**.
   Revision 1 appears as "Added · reading not checked", its three pages drawn on the left and the reading on the
   right. Ask "What rate do I start an adult Blue Trainer drill at, with a written order on file?" and the reply is
   "No reviewed answer yet for the revision now in effect", with a link to the original and no rate.
2. Compare the reading with the pages. Press **The reading matches the original**.
3. Under **Answers**, press **Add the mapping written for this invented file**. Six answers appear, each "Not
   reviewed". Open a passage with **Show in original**, read it there, and press **I have checked this against the
   original**. Do that for each, then **All answers are reviewed**, then **Make revision 1 active**.
4. Ask the same question. The answer is "Start an adult drill at 12 mk/min." followed by seven passages. Press
   **Open** on "Do not start the drill if the amber seal lamp…": page 3 of the original opens with that sentence
   outlined. **Back to the answer** returns.
5. Ask "and for a child?" for the pediatric rule. Ask "What rate do I start the Blue Trainer drill at with an order on
   file?" and Ask asks which age band; choose **Not known** and both rules are shown whole.
6. Back in **Protocols**, press **Add revision 2 of the invented protocol**. Ask the first question again: no answer,
   because revision 2 took effect on 1 November and is unreviewed. Take revision 2 through the same steps and the
   answer becomes "Start an adult drill at 14 mk/min.", citing the new file. Revision 1 is still in the history,
   marked superseded, and still opens.

## Running the checks

```sh
npm ci
npm test
npm run gate:protocols
npm run build && npm run build:demo && node scripts/check-build.mjs
# with jsdom@26.1.0 on NODE_PATH:
node scripts/check-ask-ui.cjs && node scripts/check-protocols-ui.cjs
# with Playwright and Chromium available:
node scripts/walk-protocols.cjs dist && node scripts/walk-protocols.cjs dist-demo
```

`npm run fixtures:protocols` regenerates the invented PDFs, their expected readings and the mappings. It needs
Python 3 and reportlab and is not part of any build or test. The PDFs are byte-for-byte reproducible; if their digests
change, every assertion in the protocol tests has to be read again, because the expected readings are rewritten from
whatever the reader returns.
