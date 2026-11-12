# Professional references: what arrived, what was checked, what was built

Branch `claude/reference-catalog`, on top of `claude/protocol-milestone-1`. Written 2026-11-12.

## Three kinds of source, kept apart

| Kind | What Department Hub holds | What Ask does with it |
| --- | --- | --- |
| A hospital protocol | The original file, a reading a person checked, answers a person reviewed | Answers with the whole reviewed rule, each passage one tap from the original |
| A pasted document (legacy) | Its text, as pasted | Quotes the passages that match, labelled as a legacy document |
| A professional reference | A title, a year, who lists it, a link | Points to the publisher's own copy. Answers nothing from it |

A professional reference is the weakest of the three on purpose. A published guideline is not the hospital's
protocol: it carries no local order, no local permission and no local exception. Only a held, reviewed protocol
speaks for the department. So the reference list is a way to find a document, and the app never says what one
recommends.

## What arrived

One file, `Respiratory-Source-Catalog-2026-11-12.html` (SHA-256 `713ec6c6…f38adb`), prepared by another AI assistant
at the owner's request: a self-contained page with 106 records embedded as data. The same data is kept, unchanged,
at [reference/respiratory-source-catalog-2026-11-12.json](reference/respiratory-source-catalog-2026-11-12.json).

A second file was described with it: `Protocol-Source-Pack-2026-11-12.zip`, said to contain review notes, capture
receipts, integration instructions and a draft permission request. **It was not on the owner's computer and has not
been seen.** Nothing here relies on it, and its claims (including that page captures were hashed and verified) are
unchecked.

The 106 records: 94 from AARC's clinical practice guideline index, 5 AARC guidance documents, 7 NBRC pages. Each has
a title, a link, the section of the index it was under, a year where the title prints one, and a retired flag. Twelve
also carry a few sentences describing the document. The file contains no guideline text and says so.

## What was checked, and how

Checked on 2026-11-12 from the owner's own browser.

**The 94 guideline entries match AARC's live index exactly.** Each entry's section, title and link was hashed on the
live page and in the catalog and compared in order: 94 of 94 identical, same order. Read at 11:38 UTC.

**The 5 guidance documents match the live page**, title and link.

**All 76 links to files on aarc.org answered as PDFs** (71 from the guideline index, 5 guidance documents).

**All 7 NBRC links answered.** Two are short links that lead to NBRC's current handbook and brochure, which is the
right thing to link: the dated file behind them changes.

**Of the 23 links to other organizations, 7 were confirmed** to reach the named document. One (the CDC
ventilator-associated event protocol, titled 2013 in the index) now serves a 2026 revision at the same address. Two
redirect to a journal's front page rather than the article. Two refused automated reading. Eleven could not be
retrieved by the tools available, which does not show whether they are dead or merely closed to automated readers.
Eleven of the 23 are plain `http://` addresses. **Sixteen of the 23 are therefore unverified**, and the app says on each of the 31 other-organization entries that the link is the one AARC
gives and may have moved.

**Not checked at all:** whether any document is the current edition; what any document says; reuse rights beyond
what the catalog records.

## What the catalog does not say, and should

These are not errors in the catalog. Its own fields say `currency_verified: false` on every record. They are things a
reader would assume wrongly from a list titled as guidelines.

**"Not retired" is not "current".** Of the 37 AARC guidelines outside the retired section, 26 are dated 2013 or
earlier, the oldest is 1995, and 10 are from 2021 or later. Across the whole list, 48 of the 79 entries that are not
retired are ten or more years old. In four places AARC lists an older and a newer guideline on one subject side by side
(capillary blood gas 2001 and 2022; suctioning 2010 and 2022; adult oxygen 2002 and 2022; weaning 2002 and the 2024
breathing-trial guideline). The catalog links those pairs; the app names the later one on the earlier entry.

**The 31 documents from other organizations are AARC's links, some long out of date.** The index still lists, for
example, the 2015 resuscitation guidelines, the 2013 difficult-airway guidelines and the 2007 asthma report. Their
issuers have each published later ones: a web search on 2026-11-12 finds the American Heart Association's 2025
resuscitation guidelines, the anesthesiologists' 2022 difficult-airway guidelines and the 2020 focused updates to the
asthma report. Those three were looked up as examples; the other 28 were not. The app does not try to say which entries are superseded, because a partial
list of warnings would make the rest look vouched for. It dates every entry, and flags every one ten or more years
old with "check with whoever issued it for something newer".

**The page it came from has far more than was taken.** AARC's guidance page also carries 6 current issue papers and 31
headings of current position statements, with their retired counterparts, on subjects such as respiratory therapy protocols, scope
of practice, competency, arterial lines and procedural sedation. The catalog took only the 5 guidance documents, and
says so accurately. For a department, several of those position statements matter more than, say, the manual on how
guidelines are developed. They are not in the list.

## What was built

`src/reference/respiratory-sources.json` is the list the app ships. `scripts/make-reference-catalog.mjs` derives it
from the catalog as received, and a test fails if the shipped list is anything other than what the script produces.

**The twelve descriptions are left out.** They were written by an AI assistant from abstracts, and no person has
checked them against the documents. They are careful, and they still characterise clinical guidelines ("passing a
breathing trial and being ready for extubation are separate judgments"). This app shows no unreviewed account of
what a clinical document says, so it shows none of them. They remain in the received file. A test asserts that no
sentence of any description is in what ships.

**Protocols has a third shelf**, "Professional references", under the department's own protocols and above the
pasted documents. It opens a list that can be searched by title and topic and narrowed by collection. Retired
documents are hidden until asked for and marked when shown. Every entry leaves the app by an ordinary link to the
publisher. Each shows the cautions its own listing implies: retired; issued by another organization; ten or more
years old; a later document on the same subject; a file marked as in press; credentialing or news rather than a
clinical protocol. A standing notice says these are not the hospital's protocols.

**Ask points, and never answers.** A question that names AARC, NBRC or a practice guideline is given the matching
titles, each with its year, its cautions and a link out. A question the department's own records cannot answer is
given published titles on the subject, worded as "nothing in the department's own records answers this". A held
hospital protocol always comes first, a pasted document that answers still answers, and every schedule question
answers exactly as it did. A subject AARC lists only retired documents for is named as such and not linked from the
answer. No figure, setting or instruction can appear, because nothing but titles is held.

Search is by title and AARC's topic heading only. It knows common shorthand (vent, trach, peds, ABG, SBT, CPR) and
keeps adult and pediatric apart. It will miss a guideline whose title does not name the subject asked about. The
2022 suctioning guideline is an example: the description that came with the catalog says it covers neonates, and its
title does not.

## Checks

| Check | Result |
| --- | --- |
| `npm test` | 245 pass (236 before; 9 for references) |
| `npm run eval:ask` | 63, 48 and 18 correct; 0 confidently wrong; unchanged |
| `scripts/check-protocols-ui.cjs` (CI) | Passes, now including the reference shelf and Ask's pointers |
| `node scripts/walk-protocols.cjs dist` and `dist-demo` | 16 steps pass on each |
| Builds | Both verify, 52 files each |
| Mutations of the reference code, by hand | 10 of 10 caught, after two were missed and tests were added |

The two missed mutations: offering a reference even when the department's own document had answered, and putting
references ahead of a held protocol. The tests asked questions that never reached either branch. Each now has a
question that does.

Bundle: the always-loaded script goes from 293.3 kB to 306.4 kB (100.5 to 105.0 kB gzip). The reference list is a
separate 71.4 kB chunk (8.8 kB gzip) loaded after the app starts.

## Open

Whether to ask AARC for permission to hold guideline text is a real decision and is the owner's. Without it this
stays a list of links, which needs no permission. With it, a guideline could be held like a protocol, but a
published guideline would still not be the hospital's protocol and should not answer as one.

The list is a snapshot. Nothing refreshes it. AARC's index will change and the list will not know. Keeping it
current needs either a person re-running the comparison, or the shared server reading the index on a schedule; a
browser page cannot read aarc.org by itself.

The position statements and issue papers are not included.
