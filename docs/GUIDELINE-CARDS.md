# Guidelines, restated: what a copyrighted guideline recommends, in fixed wording, checked by number

Branch `claude/guideline-cards`, on top of `main` at `6d4234c`. Written 2026-11-12.

## Why this layer exists

AARC's clinical practice guidelines are the profession's own standards, and the department's members can all read
them. Their text is copyrighted (the 2024 guideline here: Daedalus Enterprises) and carries no open licence, so the
app may not show it. What a guideline recommends, and the values it reports, are facts, and facts can be restated.
This layer restates them, without a language model and without anyone vouching for the build.

## How a card is made

A card is one of two fixed sentence patterns. There is no free text.

- A **recommendation** card: "Recommendation {number} ({strength}): {about}." The number must be the number of the
  section heading its passage sits under, and the passage must be the recommendation itself.
- A **value** card: "{what}: {value}, {when}." Every number in the card must be in its passage of the guideline, written
  the same way.

The cards are built by `scripts/make-guideline-cards.mjs` from a spec in `scripts/guideline-specs/` and the owner's
Blinders capture of the guideline. The build refuses any card whose number is not in its passage, whose recommendation
number does not match its section, whose fields are not the pattern's, or whose capture does not match its receipt.
What ships is the cards, where each passage is, the passage's length and a fingerprint of its words. **No text of the
guideline ships.** The capture stays on the owner's computer, outside the repository.

The one step that is not mechanical is choosing the passage and filling the fields. That was done once, at build
time, for this guideline. The numbers are checked by machine; whether "about" says what the passage means is not.

## How anyone can check the build

Every member can capture the guideline from their own access with Blinders and give the app that file, on the
guideline's screen. The app looks for each card's passage in their copy by its fingerprint, wherever their copy's
lines break, and checks every number again. Their copy is not kept. A card whose passage is found can then be marked,
by that member, as "I read this passage in my copy and the card says the same". That records their name with the card,
sealed so that any later change to the card drops it. Until someone has compared a card, every answer from it says
"not yet compared with the guideline by a second person".

## The first set: AARC 2024, spontaneous breathing trials

*AARC Clinical Practice Guideline: Spontaneous Breathing Trials for Liberation From Adult Mechanical Ventilation*,
Roberts KJ et al., Respir Care 2024;69(7):891–901, doi 10.4187/respcare.11735. Captured from PubMed Central with
Blinders on 2026-11-12 at 19:25 UTC: capture `803dce3b-…`, 47,980 bytes, SHA-256 `29f3a368…d70fad`, the article's
rendered text. The guideline's tables were collapsed on the page and are not in the capture.

Seven cards: its four recommendations (RSBI not needed for readiness; with or without low-level pressure support;
standardized assessment and the trial before noon; FIO2 not raised during the trial), and three values it describes as
common practice, worded as such (oxygenation commonly required before a trial; the saturation at which a trial is
commonly stopped; post-extubation NIV settings it calls anecdotal). The value cards say they describe practice; the
guideline does not set those thresholds.

## Checks

| Check | Result |
| --- | --- |
| `tests/guidelines.test.js` | 7 pass, on an invented guideline (synthetic test material) and on the shipped cards' form and routing |
| The build against the real capture | 7 cards, every number found |
| A member's copy | the same capture reflowed at every sentence finds all 7; with "FIO2 of 0.40" changed to 0.50, the two cards from that passage are not found |
| In Chromium, the built app | adding the cards, giving it a copy, finding 7 of 7 and recording a comparison all work |

## What this does not do

It does not quote the guideline, so a reader still opens their own copy to read a recommendation in full. It does
not judge whether a recommendation fits a patient. It does not know a guideline's tables when the page collapsed them.
It is not the hospital's protocol; a held protocol always answers first.

## The word check, added 2026-11-13

The owner does not want answers to depend on a second person reading every card against the guideline. The numbers
were already checked by machine; what was not checked was whether a card's words say what its passage says. Now the
build refuses a card that uses any content word its passage does not contain (compared by stem, so "trials" finds
"trial"), or that drops a negation its passage has ("not", "no", "against", "avoid", "never", "cannot", "nor").

Only articles, prepositions and plain conjunctions may be added. Modal and direction words may not: a card cannot turn
"we suggest" into "should", or "may be considered" into "is". Abbreviations come from one fixed list in
`src/guidelines.js` (`SAME_AS`: SBT for spontaneous breathing trial, RSBI, NIV, PEEP and so on), never per card. A
value card may also carry one of four fixed framing phrases (`FRAMINGS`, such as "as the guideline describes common
practice") that say where its claim stands.

What this does and does not settle. It settles that a card says nothing its passage does not say in the passage's own
words, with every negation kept. It does not settle that the words were put together in the same sense: "FIO2 should
not be increased during an SBT" and "an SBT should not be increased during FIO2" use the same words. The card titles
and the wording Ask recognises a card by (`said`) are navigation labels, not claims, and are not word-checked.

The cost: cards now read closer to the guideline's own wording. Each is still one short fragment from one passage,
and no passage ships.

A member's own copy, and their comparison, are still offered. They are extra witnesses, listed on an answer once they
exist, and no longer listed as a missing check. A card built before the word check says "Words not checked against
the passage" until it is rebuilt.

The SBT cards were rebuilt under the check on 2026-11-13 from the same capture (`803dce3b-…`). Every card had to be
reworded; the old wording used words like "decide", "raised" and "done" that the passages do not contain.

## Replaced guidelines

A set may name the guideline that replaced it (`replacedBy` in its spec). Ask answers from a replaced set only when no
newer set covers the question, and the answer says what replaced it. Which guidelines count as replaced is a
judgement recorded in `scripts/guideline-specs/aarc-catalog.json`; AARC's own page lists old and new side by side.

## The rest of AARC's guidelines

`scripts/guideline-specs/aarc-catalog.json` lists all 38 guidelines on AARC's page as of 2026-11-13 (checked against
https://www.aarc.org/resource/clinical-practice-guidelines/ and PubMed), plus the 2026 one AARC has not yet added: for
each, the web page to capture with Blinders where one was found, AARC's PDF, and its status. 18 have a full-text page
(PubMed Central or the journal at journals.sagepub.com); 10 have only a PubMed record so far; 10 have no web page
found, only AARC's PDF, which Blinders' text capture cannot read.
