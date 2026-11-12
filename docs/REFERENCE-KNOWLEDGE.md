# Reference knowledge: cards that answer, each citing its page

Branch `claude/reference-knowledge`, on top of `claude/reference-catalog`. Written 2026-11-12.

## What this is

The owner needs Ask to answer technical questions with the figure, not with a link. Most such questions are not
about one hospital's protocol at all: a normal range, a definition, how a result is read. That is general reference
knowledge, and it now has its own layer.

A **reference card** states one fact in the app's own words with the source's exact figures, names the source and the
place in it, and links to the page. Ask answers from a card only after a person on the device has opened the page and
recorded that the card matches it. Every answer says it is reference knowledge, not the hospital's protocol and not
an order for any patient.

There are now four kinds of source, strongest first: a held hospital protocol (the original file, reviewed answers);
a reference card (a cited figure, checked by a person); a pasted document (searched text); a professional reference
(a link only). A held protocol always answers first.

## The first set: adult arterial blood gases

Twelve cards from one section of an openly licensed textbook: *Nursing Fundamentals 2e*, section 15.5 "Acid-Base
Balance", WisTech Open (Open RN), 2024, Creative Commons Attribution 4.0. They cover the adult normal values (pH,
PaO2, PaCO2, HCO3, SaO2), the values the source lists as critical, acidosis and alkalosis by pH, the respiratory and
metabolic disorders, compensation, and which value the lungs manage and which the kidneys.

It is a nursing textbook, chosen because it is the clearest openly licensed statement of these figures that was
found. It is not a respiratory therapy text and not a laboratory's reference range. The cards say the values are
adult values and that a laboratory sets its own ranges.

## How the figures got here, and what is weak about it

**The source's text is not held.** The plan put to the owner was that each answer would be the source's own words.
That is not what was built, and this is why.

The tools available here could not obtain an exact copy of the page or the book's PDF: the PDF download failed and
the page came back only through a reader that returns short quotations. Two separate readings of the page were taken.
They agreed on every figure in the normal and critical values table, on the captions and step headings, and on the
sentences defining acidosis and alkalosis. Eight cards rest on that agreement and are marked "two separate readings
agreed".

To get the rest of the second table, one reader was asked to quote it a line at a time so each quotation stayed under
its length limit. One reader did; the other declined, on the ground that quoting a table piece by piece defeats the
limit. It was right, and asking was a mistake. That line-by-line copy is not used as held text. The four cards on the
respiratory and metabolic disorders, compensation and the lungs-or-kidneys description state figures from that single
reading in the app's own words, and each is marked "read once; not cross-checked".

So the chain is: the publisher's page; an AI assistant's reading of it, twice for eight cards and once for four; a
card in the app's words; a person's check of the card against the page. The last step is the only one that puts a
human between the page and the answer, and nothing answers without it. A card edited after its check, or pointed at
a different page, stops answering.

What would make it stronger: the owner saving the page as a PDF and adding it, so the app holds the publisher's own
file and the cards can be bound to passages in it, as protocol answers are. That needs the reader to handle this
page's tables, which have several lines in a cell, and it does not yet.

## What Ask does

"What is a normal PaCO2?" returns the card's sentence, the line saying what it is not, and the citation with a link
to the page. Two subjects in one question return both cards. Near-miss spelling of a card's own words is read as the
word and shown. A card that has not been checked returns "held and not checked", with no figure. A card offers no Yes
or No, and a forged one changes nothing.

A card answers only what it is about. The arterial saturation card does not answer a pulse-oximetry question:
"normal SpO2" gets no card, and a test holds that. Schedule questions answer exactly as before.

## Checks

| Check | Result |
| --- | --- |
| `npm test` | 251 pass (245 before; 6 for the cards) |
| `npm run eval:ask` | 63, 48 and 18 correct; 0 confidently wrong; unchanged |
| `scripts/check-protocols-ui.cjs` (CI) | Passes, now adding the cards, refusing a non-keeper's check, answering after the check |
| Browser walk, `dist` and `dist-demo` | 16 steps pass on each. No step was added for the cards |
| Builds | Both verify, 53 files each |
| Mutations of the card code, by hand | 9 of 9 caught |

## What it cannot do

It knows twelve things. Every further fact is another card that someone has to write, cite and check. The software
does not make that faster; it only makes each card's source and check visible.

It matches a question to a card by the card's own listed wording. A question phrased another way gets no card. It
does not interpret a result: "is a pH of 7.2 with a CO2 of 60 compensated?" returns the definitions, not a reading of
those numbers, and it must stay that way. Reading a patient's result is clinical judgement, not reference lookup.

The figures are one textbook's. Where a hospital's laboratory or protocol says otherwise, the hospital governs, and
only a held protocol can say so here.

The cited page can change after a card was checked. Nothing detects that.
