# Handoff: a shift report that never leaves the phone

Built 2026-11-13 at the owner's request: a tab where a therapist builds their report for the oncoming therapist by
typing, dictating, or photographing a vent screen or a chart, and hands it off on paper or on the screen.

## The rule it is built around

A handoff that uses bed numbers instead of names is still patient information. HIPAA's Safe Harbor route to
de-identification needs the listed identifiers removed *and* no actual knowledge that the rest could identify someone;
the oncoming therapist knows exactly who is in bed 12. So this tab does not claim the report is anonymous. Handing
off is treatment, which HIPAA permits; the exposure is where the report lives. The answer here is that it lives in one
place, on one phone, for one shift. (The rule is established; applying it to bed-number handoffs is the builder's
reading, not legal advice. Whether a hospital allows clinical notes on a personal phone is its own policy, which this
code cannot settle; the tab tells the user to check it.)

## What it does

- **Its own store.** `src/handoff-store.js` keeps the report and its photos in a separate IndexedDB database
  (`department-hub-handoff-v1`). The workspace, its backups, receipts, the activity log, the usage counts and the shared
  server never see it. The walk checks that no handoff text appears in browser storage outside that database.
- **Wiped.** 13 hours after it was started (checked when the app opens, on every screen and every action), or at once
  when its writer taps *Handed off: wipe it*. Wiping deletes the whole database.
- **Out only as paper or a screen.** *Print* lays out one block per bed and nothing else on the page; *Show at
  bedside* is a large-type view. Nothing is shared, sent or synced.
- **The template** (`TEMPLATE` in `src/handoff.js`): support, airway, mode, rate, Vt, PEEP, FiO2, PS/IPAP, flow, last
  ABG, treatments, SBT/wean, events, plan. One place to change it to a department's own sheet.
- **The screen.** Every field, every dictation and every photo goes through the board's patient screen, with two
  differences: a bed number is expected, and an age is allowed unless it is over 89. A capitalised pair of words that
  is not a known clinical term ("John Kowalski") is stopped as a possible name until its writer taps *It's not a name*,
  which holds for that handoff only.

## Photos

Every photo is boxed out the same way (`src/handoff-photo.js`), and the original is never stored:

1. Redrawn without its hidden details (location, time, phone), as the board does.
2. Read by the bundled text reader, two ways. A mostly dark photo (a vent screen) is read from an inverted grey copy.
3. **Allow list, not deny list:** a word is kept only if it is a known clinical term or a short number that is not a
   date; everything else is boxed out in black, and so is every word on a line that names a person or a record
   ("Name", "MRN", "DOB", "Acct" and so on), including short numbers on it. A name is boxed because it is not on the
   list, whether or not anything recognised it as a name.
4. The boxed copy is read again; anything still shaped like a record, or a clear word still not allowed, is boxed too.
5. The person sees it, drags a finger across anything else to box it out, and keeps it or throws it away.

Settings it can read (mode, rate, Vt, PEEP, FiO2, PS, flow) are offered as ticked boxes to put into the bed, each to be
checked against the vent. A label takes the nearest number beside or below it; nothing is guessed.

What it cannot do: see a face or a barcode, read handwriting it cannot read, or box a word it did not read at all.
It over-boxes too: on the invented test chart it boxed "Vt 450" and "q4" (misread as other words). Over-boxing is the
failure it is built to prefer. A single-letter label such as "f" for rate is often not read at all.

## Dictation

On the phone, with Whisper (`onnx-community/whisper-base.en`, pinned to revision `51eefc0…`, Apache-2.0). The model is
downloaded once from Hugging Face (about 77 MB, after the person agrees) and kept in the browser's cache; the ONNX
Runtime WebAssembly file is bundled with the app. Audio is turned into text in a worker on the phone and never sent.
This is speech-to-text, not a language model; Ask stays rule-based.

What was heard is shown in an editable box with where each part will go, bed by bed; the person fixes mishearings
before it goes in. The parser (`parseDictation`) is plain keyword reading: "bed 12", then mode, rate, tidal volume,
PEEP, FiO2, pressure support, flow, last gas, treatments, SBT, events, plan. Inside events and plan, other keywords
are part of the sentence. Anything it cannot place is shown, never dropped.

Tested with a synthetic voice (espeak), which is harder than a person: it heard "Med 12", "P-Paid" for "PEEP eight"
and "FIO 2. 40%", and got PRVC, 14, 450 and "breathing trial in the morning" right. Not yet tried on a real phone or
a real voice; speed on a phone is not measured.

## Checks

- `tests/handoff.test.js`: the 13-hour wipe, beds, the screen, fields, dictation parsing, vent reading, the mask plan.
- `scripts/walk-handoff.cjs dist FIXTURES [--shots DIR]`: 12 steps in Chromium at phone size, with an invented chart,
  an invented vent screen and a synthetic recording played as the microphone: start, beds, the name screen, a chart
  photo boxed out (name, record and birth-date regions measured black, settings readable), a vent screen read,
  dictation through the real model, bedside and print, nothing outside the handoff store or the app and model
  addresses, the wipe, and the 13-hour wipe on reopening. Not in CI: it needs the model download.
