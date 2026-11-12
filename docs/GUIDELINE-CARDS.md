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
