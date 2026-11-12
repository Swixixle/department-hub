# Reference knowledge: cards that answer, each resting on a captured page

Branch `claude/reference-capture`, on top of `claude/reference-knowledge` as pushed (`1a963e0`). Written 2026-11-12.

## What this is

The owner needs Ask to answer technical questions with the figure, not with a link. Most such questions are not
about one hospital's protocol at all: a normal range, a definition, how a result is read. That is general reference
knowledge, and it has its own layer.

A **reference card** states one fact in the app's own words. Under it are the passages of the source page it rests
on, shown exactly as captured. Ask answers from a card only after a person on the device has compared the card with
those passages and recorded that it says what they say. Every answer says it is reference knowledge, not the
hospital's protocol and not an order for any patient, and shows the source's own words under the card.

There are four kinds of source, strongest first: a held hospital protocol (the original file, reviewed answers);
a reference card (resting on a captured page, checked by a person); a pasted document (searched text); a
professional reference (a link only). A held protocol always answers first.

## The first set: adult arterial blood gases

Twelve cards from one section of an openly licensed textbook: *Nursing Fundamentals 2e*, section 15.5 "Acid-Base
Balance", WisTech Open (Open RN), 2024, Creative Commons Attribution 4.0. They cover the adult normal values (pH,
PaO2, PaCO2, HCO3, SaO2), the values the source lists as critical, acidosis and alkalosis by pH, the respiratory and
metabolic disorders, compensation, and which value the lungs manage and which the kidneys.

It is a nursing textbook, chosen because it is the clearest openly licensed statement of these figures that was
found. It is not a respiratory therapy text and not a laboratory's reference range.

**The critical values are one laboratory's.** The capture shows what the earlier cards missed: the table's title
carries note [2], and note [2] is "WakeMed Pathology Laboratories. (2016). Critical values." The textbook took its
critical values from one hospital laboratory's list of 2016. Every card that states a critical value now says so, and
shows that note among its passages. A department's own laboratory sets its own critical values.

## How the page got here

The owner's capture tool, Blinders, saved the chapter from his own Chrome on 2026-11-12 at 14:55 UTC:

| | Capture | Bytes | SHA-256 |
| --- | --- | --- | --- |
| The chapter's rendered text | `cef48181-5ed3-4ff5-b07d-382304cdcf95` | 25,965 | `cf48652c3a646897627597f3827d14b412a963bc7e354604b4c9524071cde3e7` |
| The page's licence line | `b0473561-e3f8-41c7-bb7f-0f8267669a62` | 163 | `bb75fe52a30252cbac59bb5ecb8f89d4f3beb09f99f461584cb299f31dccc495` |

Both were taken through Blinders' bridge: the inbox asked the paired tab for the rendered text of one element (the
chapter section, and the licence line), and Blinders hashed and stored what the browser returned. The owner exported
them to his project folder; the export re-hashed each file against its receipt. They are held in
`src/reference/sources/` with Blinders' receipts beside them, byte for byte (Git treats them as binary so nothing can
re-wrap them).

**What a capture is and is not.** It is the text as Chrome rendered it: table cells separated by tabs, a cell's lines
on separate lines. It is not the page's HTML, and it holds none of the page's images or videos. The receipt is a row
in a local database with no signature, so it shows which bytes were saved and when; it does not show that no one
changed that database since. The page was licensed CC BY 4.0, which permits holding and showing its text with credit;
the licence line is shown with the cards, and the cards say their wording is the app's and the passages are unchanged.

This replaces the earlier set, whose figures were read from the page by an AI assistant through a reader that returned
only short quotations, with the page's text not held. One of those cards also said something the page does not: that
SaO2 "is not the pulse-oximeter reading". The capture shows no such sentence, so the new card does not say it. Every
other figure on the earlier cards was found in the capture.

## What the app checks, and what a person checks

When the cards are added, in the browser, three things are checked mechanically and the cards are refused if any fails:

1. The held page and licence line hash to the SHA-256 and byte count in the capture receipt.
2. Every passage a card cites is a run of lines that exists in the held page and is not blank.
3. Every number a card states (7.35, 60, 2016) appears in that card's own passages.

Check 3 catches a mistyped or invented figure. It does not catch a figure moved to the wrong place: if the PaCO2
card said the critical high was 45 instead of 60, 45 is in the same passage (as the top of the normal range), and the
check would pass. That is why a person still checks each card, now against the passages shown under it rather than a
page somewhere else. The check is recorded with a seal over the card, the text of its passages and the capture receipt; changing
any of them afterwards stops the card answering.

Cards held from the earlier format stop answering, and adding the captured set withdraws them with the reason
recorded. A card the owner checked in the earlier set must be checked again in this one.

## What Ask does

"What is a normal PaCO2?" returns the card's sentence, the line saying what it is not, and under it the source's own
words: the table's title, the PaCO2 row exactly as captured, and the note crediting the critical values. The citation
names the capture and its digest, and links to the live page. Two subjects in one question return both cards. A card
that has not been checked returns "held and not checked", with no figure and no passage. A card offers no Yes or No.

A card answers only what it is about. The arterial saturation card does not answer a pulse-oximetry question, and
schedule questions answer exactly as before.

## Checks

| Check | Result |
| --- | --- |
| `npm test` | 253 pass (251 before; the card tests rewritten, 8 now) |
| `npm run eval:ask` | 0 confidently wrong; unchanged |
| `npm run gate:protocols` | 16 of 16 faults caught |
| `scripts/check-protocols-ui.cjs` (CI) | Passes; now checks the built app holds the captured page by its digest and shows the captured row in Ask |
| Browser walk, `dist` and `dist-demo` | 17 steps pass on each; the new step adds the cards on a phone, checks one, and asks |
| Builds | Both verify, 55 files each; the built page chunk hashes to the capture's SHA-256 |
| Mutations of the card code, by hand | 9 of 9 caught |

## What it cannot do

It knows twelve things. Each further fact is another card that someone writes and checks, though the capture now
makes the check a comparison on one screen.

It matches a question to a card by the card's own listed wording. A question phrased another way gets no card. It
does not interpret a result: "is a pH of 7.2 with a CO2 of 60 compensated?" returns the definitions, not a reading of
those numbers, and it must stay that way. Reading a patient's result is clinical judgement, not reference lookup.

The held text is checked against its receipt when the cards are added, not each time the app opens. A change to the
stored copy afterwards stops a card answering if it touches that card's passages, because the check's seal covers
them; a change elsewhere in the stored page is not detected.

The live page can change after it was captured. Nothing detects that; the cards rest on the capture, and say so.
