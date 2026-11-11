# Direction after the handoff

Recorded 2026-11-10 from the owner's conversation with Claude. Read this after `CLAUDE-HANDOFF.md`. Where the two differ, this file is newer.

## What the owner has decided

- **The schedule is the way in.** A coworker opens a link and sees their own shifts and who they work with. The board and conversations grow out of schedule activity.
- **Staff-run companion.** The employer's official scheduling and timekeeping system stays the source of truth. This app holds a dated copy of the schedule and helps people coordinate. It never claims to approve or confirm anything.
- **Phone and touch first.** Tap a shift and it highlights. A short action sheet opens with the few things you can do.
- **A scrolling department board** where schedule events appear as posts next to ordinary posts.
- **Fairness tracking.** Keep track of seniority, call-offs, pickups and trades so that imbalances can be evened out on the next schedule. Seniority means time in the department.
- **Check-ins at the middle and end of each schedule**, because by the end of a schedule most of what happened is forgotten. Schedules run three to four months.
- **Recognition** for people who carry extra load.
- **Department example.** Four on days and three on nights, seven days a week, 12-hour shifts, three shifts a week for full time. Nights have seven or eight staff, seven of them full time. The day headcount is still to be counted.

## Recommended by Claude, waiting for the owner's decision

- **Phone-first web app joined by a link, before any native packaging.** Store packaging adds developer fees, signing and an install step for each coworker. It does not address shared data, the real schedule layout or the eligibility rules.
- **An "entered in the official system" step** at the end of a trade or coverage request. Either person taps it once the change is approved, and the app's copy of the roster updates.
- **A credit-only ledger.** Record who covered a shift and who helped, and never rate coworkers. Proposed rules:
  1. A separate ledger for each kind of event: weekends, holidays, short-notice pickups, premium shifts, cuts.
  2. Each person's score is actual minus fair share, where fair share is the pool total times that person's fraction of the shifts worked.
  3. On the next schedule, whoever is furthest below their share goes first for a burden, and whoever is furthest above goes first for a perk.
  4. Seniority decides only when two people are within one shift of each other.
  5. Balances fade by half each schedule. Holidays keep a memory of several years.
- **Capture at the time, not from memory.** Trades and pickups log themselves. A ten-second check-in after a shift feeds the mid-schedule and end-of-schedule summaries.
- **Order of work.** Eligibility fixes (done, below), the real schedule layout (first version done, below), the phone view with the shift action sheet, then shared accounts and the board.

## Fixed on branch `claude/fix-eligibility-checks`

All three were reproduced in the public demo before the fix and checked again in a browser afterwards.

- **A shift could be agreed twice.** Agreed requests now reserve their shifts, a second acceptance is blocked on recheck with the reason shown, and the shift's own dialog links to the agreed request. Sending the same request twice is refused.
- **Agreed changes did not count toward hours.** Checks now run against the roster with agreed requests applied, so an agreed pickup counts toward overtime, overlap and rest before it reaches the official system.
- **Unknown staff details skipped the roster checks.** Overlap, rest and overtime checks now always run. Unknown details only lower the result to "needs verification". The same shift went from 40 listed matches to 10.
- **Back-to-back shifts passed as eligible.** A new starter rule, `minimumRestMinutes`, blocks a change that puts a night and a day back to back. The value is illustrative, like the other starter rules. The rule version is now `pilot-2`, and saved workspaces pick it up on load.

## Added on branch `claude/calendar-import`

The owner supplied photos of the real schedule on 2026-11-10. It is a paper calendar in a binder: four-week pages, Sunday to Saturday, separate day and night sheets, short dates with no year, first names in capitals, highlighter, and handwritten changes. Neither earlier layout could read it.

The owner's rules for reading it:

- Ignore handwriting unless a printed name is crossed out.
- Pink highlighter means charge. Green means ICU. Blue means nothing.
- Handwritten initials next to a change belong to the lead, who has final say.
- "VA" with a time is a volume adjusted absence, a low-census cut.

What the branch adds:

- **A calendar reader** (`src/calendar.js`). It finds the date cells, works out the year from the weekday columns, assigns each printed name to its date, keeps an initial ("Jordan K") and partial hours ("7-3"), and guesses day or night from the names per cell. The review screen shows the guess with a switch.
- **Photo clean-up before reading** (`src/pixels.js`). Highlighter is removed and uneven lighting is evened out before OCR. This applies to every layout.
- **Crossed-out names.** A long level pen stroke through a name drops that name and flags the cell with the photo crop. Nothing is guessed.
- **Roles from colour.** The roster shows charge and ICU with the same pink and green as the paper.
- **Partial shifts** count their real hours in overtime and rest checks.
- **Safer names.** A lost space is repaired and listed. A near-miss spelling is put to the reviewer as a question. A cell with fewer names than most is flagged.

Checked in a browser against one real photographed day page, compared with a hand transcription: 91 of 105 printed names were accepted with none wrong, the other 14 all sat in flagged cells, all five crossed-out names were flagged with no false alarms, and all 28 dates, every role colour and every partial shift read correctly. The fictional calendar fixture reads 192 of 192. The original ten-page fixture still reads 217 of 217. One real page is a small sample. Night pages and other months are not yet checked.

Not done yet: reading the handwritten replacement next to a crossed-out name, recording VA times, and yellow highlighter (the page legend says "Extra", the owner has not confirmed it).

## Added on branch `claude/review-flow`

The owner ran four real pages through the calendar reader and asked for two changes to the correction step.

- **One screen per shift, one box per person.** A flag now opens every name read for that date and shift, in page order, each with its own name box, role and partial hours. Unsure readings are shaded. Saving replaces that shift's names, so a wholly highlighted cell can be fixed in one go. Flags on the same shift are settled together.
- **Save moves to the next flag.** Saving or leaving a flag opens the next open one. The review screen has a single button to start, and the title counts what is left.
- **The photo is cropped and enlarged** to the cell in question.

Checked in a browser on the same real page: 20 flags became 16 screens, each save advanced on its own, and the published roster matched the hand transcription 105 of 105.

## Added on branch `claude/directory`

The owner's direction on 2026-11-11: the department telephone list matters as much as the schedule. The app is meant to be how people in the department reach one another and stay informed. He wants the numbers in it, direct messages between coworkers, and a department feed with news.

What this branch adds, all of it on one device with no server:

- **Telephone list import** (`src/contacts.js`). The same import flow recognises a photographed telephone list. Table lines are erased, rows are followed along the tilt of the photo, and the page is read twice in two modes. A number is accepted only when both readings agree. The rest are shaded on a check screen that shows a strip of the photo above each person.
- **Directory tab** with people grouped as on the list, and Call and Text links.
- **Matching** of schedule names to people: first name plus last initial, then a unique first name, then short forms and shared openings, which are shown as guesses to confirm.
- **Staff details fill themselves in.** Employment status comes from the list's section, and the shifts a person works come from the roster. Students are kept out of trades and coverage by a starter rule.
- **Text a request.** A trade or coverage request can be sent from the phone's own Messages app with the wording filled in, because this app cannot notify anyone yet.
- **Launcher.** `serve.py` opens the browser and replaces an older copy on the same port.
- **Reading fixes** from three more real pages: pale green highlighter is recognised, and a strike through a short name is caught.

Checked in a browser. Four real schedule pages against hand transcriptions: 327 of 361 printed names accepted, none wrong in name, role or hours, every other name inside a flagged cell, and all 21 crossed-out names flagged with two false alarms. Two real telephone lists: all 30 people found in the right groups, 20 numbers agreed by both readings and the other 10 shaded for checking. Number endings were compared with the photos by eye. Full numbers were not transcribed, so the owner's check on that screen is the real verification.

Telephone numbers are personal data. They live only in the browser's storage on the device, they are left out of receipts, and no real name or number belongs in this repository, its fixtures or its demo. The demo uses invented people and 555-01xx numbers.

**Next: the shared service.** Direct messages, a department feed and news need accounts and a server, which this app does not have. The telephone list gives a natural membership rule: only people on the list can join. That is the next large piece of work and it is not started.

## Added on branch `claude/fairness`

The owner's direction on 2026-11-11: easy controls, ways to track fairness, things kept documented, proof of shift-change agreements, and a way for the department to talk that does not depend on personal phone numbers, because people get left out. Helpful acts should be acknowledged, such as offering to go home in place of the person who was next for a low-census cut, or being the one who accepts a trade. He suggested a "stat sheet" like an athlete's line for a game. He agreed that surveys rating coworkers are a bad idea and that nobody should be singled out.

The rule this branch follows: count what people carried and the times they helped. Never count call-offs, declined requests or opinions.

- **Fairness tab** (`src/fairness.js`). For day shift or night shift, each person's shifts, weekend turns, fair share and the difference, with holidays, charge and ICU turns alongside. The headline says how many regulars are within one weekend turn of their share and who would be first in line for the next one. Fair share follows shifts worked. Students are left out. A weekend-only position, set in Staff details, is left out of the weekend pool.
- **Stat sheet** for the person using the app: shifts, weekend turns against fair share, holidays, charge, ICU, trades accepted, shifts covered, times they went home for someone, and low-census hours.
- **Low-census record** on any shift: hours, whether the person offered or was sent, and whose turn they took. Offered and directed hours count the same toward who is next, so offering never moves a person to the front of the line.

Why "within one turn" is the target: for a single kind of turn handed out one at a time, a rotation exists that keeps everyone within 1 − 1/(2m−2) of their fair share at every point (Tijdeman, Meijer). When a schedule is planned ahead with known time off, within one is still achievable. When turns are decided day by day, the simple lowest-share-first rule is only guaranteed to stay within (n−1)/2 (Ajtai and others, the carpool problem). Several kinds of turn at once, with hours and rest limits, have no such guarantee. A simulation of lowest-share-first with seven people and three per night stayed within 0.86 of a turn over 144 weekend nights.

On the owner's real November and December night pages, as printed, the weekend spread among the six regulars was 6.4 turns. The module reproduces a hand calculation of the same pages.

Open design point for the shared version: the full table is a standings table. Each person should see their own sheet and the department spread. The full table belongs to whoever builds the schedule.

## Still open from the review

- Matches that are blocked are hidden with no reason given.
- A date missing from an import is not detected, so weekly hours can be understated.
- Schedule names are checked against the rest of the batch. They are matched to the telephone list only after import.
- Import flags are cleared one at a time, and an unsupported layout offers no way to enter shifts by hand.
- Source images from an abandoned import stay in browser storage until the workspace is erased.
- Exported receipts have no checker.
