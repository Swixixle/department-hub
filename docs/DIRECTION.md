# Direction after the handoff

Recorded 2026-11-10 from the owner's conversation with Claude. Read this after `CLAUDE-HANDOFF.md`. Where the two differ, this file is newer.

## What the owner has decided

### Current rollout scope, clarified 2026-11-11

The owner plans to introduce the app through his own department, invite willing coworkers, ask for patience and feedback, and improve it around their daily use. He expects to pay for a server in a few weeks and wants preparation done beforehand.

- One private workspace per department, accessible only to approved department members. Each person has their own department account, email and credentials; this is not a shared login.
- One readily available place for the department's schedule, updates, due dates, meetings and conversations. Avoid proliferating channels and group-selection buttons.
- Information ordinarily sent through email should be easier to consume here. Automatic mailbox integration and replacing email are not part of this direction.
- Departments remain isolated. Another job, cross-department membership, a workspace switcher and broader organizational administration are outside the current scope.
- The next milestone is useful adoption by this department, not a generalized enterprise scheduling product. Prepare shared accounts, storage, membership enforcement, synchronization and separate-person agreements against synthetic fixtures before the paid service is selected.

`docs/SERVER.md` turns this direction into proposed implementation stages and launch checks. Its detailed authentication flow and privacy recommendations remain design proposals; they are not features already built. Existing local storage, the fictional public demo and the Version 12 runtime are unchanged by this planning update.

### Earlier direction, retained for context

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

Decided by the owner on 2026-11-11: people join by an invite link. Recommended shape: one personal link per person on the list, sent from the Directory's Text button to the number on the list. A single shared link can be forwarded, and whoever opens it could claim any name. A personal link ties the account to the number the department already trusts, with no texting service to pay for.

## Added on branch `claude/fairness`

The owner's direction on 2026-11-11: easy controls, ways to track fairness, things kept documented, proof of shift-change agreements, and a way for the department to talk that does not depend on personal phone numbers, because people get left out. Helpful acts should be acknowledged, such as offering to go home in place of the person who was next for a low-census cut, or being the one who accepts a trade. He suggested a "stat sheet" like an athlete's line for a game. He agreed that surveys rating coworkers are a bad idea and that nobody should be singled out.

The rule this branch follows: count what people carried and the times they helped. Never count calling in sick, declined requests or opinions. A low-census release is a different thing from calling in sick. It is the department sending someone home, and it is counted because it costs the person hours.

- **Fairness tab** (`src/fairness.js`). For day shift or night shift, each person's shifts, weekend turns, fair share and the difference, with holidays, charge and ICU turns alongside. The headline says how many regulars are within one weekend turn of their share and who would be first in line for the next one. Fair share follows shifts worked. Students are left out. A weekend-only position, set in Staff details, is left out of the weekend pool.
- **Stat sheet** for the person using the app: shifts, weekend turns against fair share, holidays, charge, ICU, trades accepted, shifts covered, times they went home for someone, and low-census hours.
- **Low-census record** on any shift: hours, whether the person offered or was sent, and whose turn they took. Offered and directed hours count the same toward who is next, so offering never moves a person to the front of the line.
- **Over-staffed shifts.** The owner pointed out that a night sometimes lists four people where three is usual, and one of them is certain to be released. The app finds these on its own. "Usual" is the most common headcount for that shift in the roster, so there is nothing to set up. The schedule marks the shift ("4 listed · 1 over"), and tapping the mark shows who is next and a one-tap way to record who went home. The Fairness tab lists the over-staffed shifts still to come, the past ones with nothing recorded, and for each person how often they are on such a shift, their share of the cuts, and what they have given up. A shift that lists fewer than usual is noted too.
- **Who is next for a cut.** Fewest hours lost goes first. Between people level on hours, the one released longest ago goes first. Anyone still level is shown as tied. The app does not invent an order, and it does not break ties by name.
- **Share of the cuts.** On a shift with four people where three are usual, each of the four carries a quarter of that cut. This is the fair share from the carpool problem. It makes visible when the same people keep being scheduled on the over-staffed shifts, which is a scheduling outcome that the hours rule alone would hide.
- **Extra weekends by choice.** The owner asked how to treat someone on a regular position who offers to take most weekends, and said it should be taken into account. Staff details now has three weekend arrangements: regular rotation, weekend-only position, and regular position taking extra weekends by choice. A volunteer's weekend shifts come out of the rotation exactly as a weekend-only person's do, so nobody else is measured against them and nobody ends up "owing" weekends because a coworker volunteered. The turns beyond a regular share are shown as credit on the table and on the volunteer's own sheet. The credit does not buy anything automatically. What it should be worth is for the department to decide. A rule that hands out perks should not be written by someone who could collect them.
- **Phone layout.** With five tabs the top bar pushed every screen sideways on a phone. On narrow screens the tabs are now a bar fixed to the bottom.

Why "within one turn" is the target: for a single kind of turn handed out one at a time, a rotation exists that keeps everyone within 1 − 1/(2m−2) of their fair share at every point (Tijdeman, Meijer). When a schedule is planned ahead with known time off, within one is still achievable. When turns are decided day by day, the simple lowest-share-first rule is only guaranteed to stay within (n−1)/2 (Ajtai and others, the carpool problem). Several kinds of turn at once, with hours and rest limits, have no such guarantee. A simulation of lowest-share-first with seven people and three per night stayed within 0.86 of a turn over 144 weekend nights.

On the owner's real November and December night pages, as printed, the weekend spread among the six regulars was 6.4 turns. The module reproduces a hand calculation of the same pages. With the heaviest weekend carrier marked as taking extra weekends by choice, the spread among the other five is still 3.4 turns, so volunteering lightens everyone's share without evening out the rest. The same pages list four people on three nights and two people on four nights, against a usual three.

Assumptions in the low-census rule that the owner has not confirmed: that everyone on the shift is in one line, with no tier that goes first such as contract or PRN staff, and that a weekend shift a person was released from still counts as their weekend turn.

Open design point for the shared version: the full table is a standings table. Each person should see their own sheet and the department spread. The full table belongs to whoever builds the schedule.

## Added on branch `claude/edit-and-backup`

Two things from the owner on 2026-11-11.

First, he opened the app and found sample names where he expected his schedule. The workspace lives in one browser at one address. He had two browsers open and the app had been started at two different addresses, and no copy of an earlier import could be found in any of them. Nothing in the app said where a workspace was kept, there was no way to move one, and an import that had been read but not published was lost when the page closed.

Second, he asked again for several lines when entering names on the schedule, one name per line, and for a name entered twice to be noticed and fixed.

- **Edit a shift on the schedule.** Every shift has an "Edit names" button. It opens one line per person with role and partial hours, and more lines can be added without losing what is typed. Saving replaces that shift's names. People who stay keep their photo source. People added by hand are marked as such. Each edit is a receipt with the names before and after. This is how a handwritten replacement gets onto the roster without importing again.
- **One person per line** (`tidyNames` in `src/model.js`), used by the shift editor and the import review. A line that holds several people is split: commas, slashes, "and", or several known names in a row. A known name that contains a space is never split. A name entered twice is kept once, and the app says so. A name that matches a known one takes the known spelling. A name nobody has used before is pointed out so a typo does not become a new person.
- **Where the workspace is kept.** The side bar and the workspace data dialog name the browser address. When nothing is saved there, the schedule says so in plain words and offers to restore a backup.
- **Backup and restore.** One file holds the schedule, contacts, requests and history. Restoring shows what the file holds and what it will replace, and waits for a second press. Photos are not in the file. The file contains names and phone numbers, so it is the user's to keep private.
- **Erase asks first** and says what will be removed.
- **An unfinished import is kept.** The draft is saved after every step and offered again after a reload, with its photos.
- **The schedule opens on today** when the roster covers it, and has a Today button.
- **The import count** shows shifts to check. It used to add the structural notes to that number, which made a four-page import look like 120 items of work when 61 shifts needed a look.

Checked in a browser: the editor with a doubled name, several names on one line and a new name; a backup saved, the workspace erased and the backup restored; an import interrupted by a reload and continued; and the four real schedule photos imported, reviewed and published on this build, matching the hand transcription 361 of 361.

Still missing: the launcher takes a port number and the workspace is tied to it. Start it without a number every time. A shared service is what removes the problem for good.

## Added on branch `claude/board-media`

The owner's direction on 2026-11-11, after seeing the hosting comparison: leave the server for now, but have the app ready so that switching it on is easy. He described the board as a social app built around the department and the profession. Posts should carry pictures, files, messages and video. Educational, CEU-type videos should play on the scrolling board. Anything on the board should be shareable to phones, websites, YouTube, email or wherever it is needed. And sending a voice message to the whole department should be quick and streamlined.

- **Posts carry files.** Up to ten per post. Pictures show in the feed, video and audio play there with the browser's own player, and anything else is a download. A video or recording that is playing keeps playing when the page redraws.
- **YouTube and Vimeo links play on the board** after a tap. Nothing loads from those sites until then.
- **Learning.** A post can be marked as instructional, and the board has filters: All, Learning, Voice, Photos and video, Files.
- **Voice message to everyone.** One button on the board. Recording starts as soon as the microphone is allowed, one tap stops it, the recording can be played back, and one tap sends it. It stops by itself at three minutes.
- **Share** on every post. On a phone it opens the phone's own share sheet and hands over the file itself. Where a browser has no share sheet, it offers copy, email, text message and a download for each file. The poster can keep a post inside the department, which removes the Share button. That is a courtesy, not a lock: a screenshot gets around it.
- **Remove**, for the person who posted.
- **The rule on patient information** is shown at every upload and recording.
- **The plug-in point** (`src/backend.js`). The board reaches posts and files through six functions. Today they keep everything in this browser. A hosted service provides the same six. `docs/SERVER.md` has the plan, the hosting figures and the risks.

Checked in a browser with a simulated microphone and real files: a post with a picture, a video and a document; playback surviving a redraw; a voice message recorded, played back and sent; the share sheet receiving the recording as a file; the fallback choices; a post kept inside the department; a reload; and removal taking the files with it. Not checked: real phones, the real share sheet, playback of recordings between different kinds of phone, and the YouTube and Vimeo players against the live sites.

Until the shared version is on, a post, a voice message or an upload stays in the browser it was made in. The board says so.

## Added on branch `claude/fairness-record`

Two directions from the owner on 2026-11-11.

**The look and feel matter a great deal.** He asked what research says about ease of use across ages and skill levels, and to place controls where people already expect them. The evidence gathered: most adults are at the lowest skill levels (OECD, 215,942 people, 33 countries); the touch-target minimum from research is about a centimetre, and larger for older adults; hidden navigation is used far less than visible navigation; about half of people hold a phone in one hand; a response under a tenth of a second feels instant; and a first impression forms in under a twentieth of a second, driven by simplicity and by looking familiar. Measured against that, the app had 35 of 41 Schedule controls under 48 px at phone size and more than half its text under 12 px.

- **Sizes** (`src/sizes.css`): a main action is 60 CSS px tall, any other control 48, sentence text 16. Sizes are in rem. An **Aa** button gives three text sizes, and the browser's own text size is followed. CSS px match points and dp by design, but their physical size differs between devices, so real phones still need checking.
- **Phone layout:** one day per row with names in full; one person per block in the name editor; dialogs as bottom sheets with the title and the main action pinned; labelled tabs at the bottom.
- **Restore and erase** each get a sheet of their own.
- **Press counts,** kept on the device: fixed button names and totals only. No names, shift keys, typed words or recordings. Left out of backups. Not counted in the public demo.
- **`docs/USER-TEST.md`:** five tasks to watch five different coworkers do, recording completion, wrong presses and help needed.

**Fairness is to be refined, and there has to be a custodian of the record.** It is for tracking when people are getting the worse of the schedule or taking more of the load, and for tracking holidays. It did not need to look the way it did.

- **Everyone** sees their own sheet, with one plain sentence about where they stand, and the department picture without names.
- **Whoever keeps the record** sees who is carrying more than their share and who less, a holiday tracker (who worked which holiday, day or night), the low-census ledger, and the full table folded away. They choose which holidays count and can add days. They can export the record as a spreadsheet file.
- **The keeper** is set in Staff details. Until someone is set, anyone can take it on. On one device this is a courtesy, because "Viewing as" lets anyone look. Real access control comes with accounts.
- **The record outlasts a schedule.** When a new schedule is published, shifts in date-and-shift cells it does not supply are carried forward, and the Fairness tab can show this schedule or everything on record. Importing a corrected day page replaces those day cells and preserves the nights and missing dates. An import cannot establish that an absent cell is empty; those earlier entries remain on record.
- A person listed only on weekends is pointed out to the keeper, in case theirs is a weekend-only position.

Checked in a browser at phone size: after upgrading a Version 7 workspace in place, the schedule, a contact, posts and their files were all still there; five tasks were completed by tap (find a shift, correct a replacement, ask for coverage, post a recording, back up, erase and restore); the press counts held only button names; and the member view of Fairness showed no name but the viewer's own. Not checked: real phones, and real people.

### Integration review

The two supplied Version 8 commits applied on top of PR #2. Review reproduced two defects with failing regression tests: a partial day-page correction discarded archived nights and missing dates, and the selected schedule's personal totals included earlier releases and trades. Both are fixed. Publication also retains staff profiles for people absent from the next roster, so historical students and weekend-only positions remain excluded. Switching between fictional and local schedules starts a separate record and holiday configuration.

Personal and low-census totals, including the CSV export, now follow the selected record's date span. The low-census section uses the selected roster/history, with archived dates shown as read-only. Release order still uses all recorded hours, so earlier voluntary releases continue to protect a person. Earlier activity is visible by selecting Everything on record. Historical fairness uses the staff settings currently kept in Staff details; historical employment/arrangement changes are not versioned.

Independent checks: 47 Node tests pass, including three new record regressions, and both production builds pass. The two launcher checks passed on the original patch; launcher code is unchanged by these fixes. Browser task replay, physical-phone sizing and real-person usability were not independently rerun during this integration.

## Added on branch `claude/fairness-record`: Ask

The owner's direction on 2026-11-11: a department assistant behind one button, which he does not want called a chat bot. Ask it when things are due, about meetings and new messages. It should read the schedule and the board, and know the protocols, policies and procedures. He wants it in.

What is in is the part that needs no language model.

- **Ask** (`src/ask.js`), a button on every screen. A question is matched to a kind of lookup, the lookup runs on the app's own records, and the answer says where it came from with a button that opens the record. It answers: when someone works, who is on a shift, who the person is working with, what is new on the board since they last looked, what is due or coming up, how to reach someone, the person's own fairness standing, shifts with more or fewer people than usual, and anything the added documents say.
- **It does not guess.** When nothing on record answers a question it says so, and offers to put the question on the board so the answer ends up on record.
- **Whose word it is.** An answer from a document carries the title, section, kind (policy, procedure, protocol, manual) and effective date. An answer from the board is labelled as a coworker's post, not policy.
- **Access is applied before the lookup.** Another person's fairness numbers are given only to whoever keeps the record.
- **Dated posts.** A post can be marked due, a meeting or an event, with a date. The board has a Dates filter.
- **Documents.** A small library Ask can search, added as a text file or pasted text, with what it is and its effective date. Text is kept in the workspace and goes into backups. The receipt for adding one records the title, not the words. PDFs are not read yet.
- Question text is not saved or counted. The press counter records only that a question was asked.

It does not learn, summarise or understand phrasing outside the shapes it knows. Broader language support is a separate future stage. The hosted API option in `docs/SERVER.md` would incur provider charges and send selected records to that provider; a local model is not implemented either. A future model should receive only records the person asking is allowed to see.

Limits to respect: only documents the department is allowed to share should be added. For a clinical protocol, Ask quotes the passage and its date. It gives no advice about a patient.

### Ask integration review

The phone and fairness commits in the Version 9 patch were already on PR #2. Only the new Ask commit was applied, retaining all Version 8 record fixes. The documentation merge kept both sets of notes.

Review corrections: the next shift itself now has an Open link; explicit years and impossible dates are handled; disabling holiday credit does not erase its calendar date; explicit policy/protocol questions search documents before board or staffing keywords; missing staffing data no longer produces a normal-staffing claim; and fairness describes scheduled turns rather than asserting they were worked. When a current time is supplied, next-shift queries skip shifts that have already started. Sample posts without a timestamp can be opened safely.

Ask is in the header so it cannot float over another control. Answers are recomputed from the current viewer and records whenever the sheet is shown, and switching viewers clears the previous question. Document source passages scroll after the sheet opens. Board read markers update immediately in memory and storage, and opening a post from Ask also marks the board viewed. Restore and erase clear question state and the read marker.

Independent checks: 59 Node tests, two launcher checks and both production builds pass. An additional simulated-DOM run of the production bundle checked viewer changes, document removal and reopening, passage scrolling, board read markers, question text remaining absent from storage, roster preservation and no external requests in those Ask flows. This was not a real browser or physical-phone check. The keeper restriction remains a single-device courtesy; document matching does not establish that an uploaded policy is approved, current or controlling.

## Added on branch `claude/fairness-record`: reading messy questions, learning, the notice and the log

The owner's direction on 2026-11-11: get Ask as close as possible to the things it was not. It has to read misspellings and bad grammar, know which words matter, keep context and learn. Everything has to be tracked, hashed and audited. The top of the app has to say plainly that this is not an official hospital product, and warn against revealing patient information. He asked how close this gets with no language model in the loop. Paraphrasing policies can wait.

- **How a question is read** (`src/words.js`). Shorthand is spelled out (`whos workin tonite` is read as `who is working tonight`). A misspelled word is corrected only toward a word the app already knows: its own question words, names on the schedule and words in the added documents. The measure is Damerau-Levenshtein distance, one edit for short words and two for long ones. Word endings are stripped, filler words are dropped, and a short list of the department's other words for a thing (PTO, leave, time off) lets one find the others. When a question was changed, the answer shows **Read as** with the words it used.
- **Which kind of question it is** is selected from supported keyword patterns. Some rough grammar and word order are tolerated; this is not general language understanding. A follow-up such as `and Saturday?` keeps the previous shift pool unless another is specified. Names, dates and subjects can still need clarification.
- **Document search** ranks passages with BM25, the formula search engines have used since the 1990s, with near-miss spellings and the synonym list.
- **Learning is explicit relevance feedback.** After opening a passage, **Yes, remember this wording** saves search words bound to the exact document version, not approval of its contents. The same labelled action can add wording to a custodian note. A **No** offers a review before saving a question for the keeper. The review explains that the words enter the workspace and backups. Taught notes are labelled as human-written guidance, not official policy; original passages and live structured records take precedence. A linked note stops matching when the source changes, disappears, is withdrawn or is not yet effective. Unversioned legacy feedback is retained but is not used to boost passages.
- **What this is not.** It does not understand a sentence. A question worded far from anything it knows gets "Nothing on record answers that", which is the honest result. It does not summarise or reword a document. Sound-alike words are not caught, apart from one (`when is it do`).
- **An optional next step** is a small sentence-embedding model in the browser. It can rank existing text by similarity of meaning without generating new text, but can still select the wrong passage. It remains unimplemented and unmeasured; there is no current model download or outside AI call.
- **The notice** identifies an independent staff project, not an official hospital product, and prohibits patient information. It is shown on screens and sheets. The first-use notice requires **I understand** and its receipt must save before acknowledgement is recorded. It accurately describes recorded actions, the optional retention of learning examples, profile/clock limitations and the lack of active monitoring. Hashing is not encryption, PHI prevention, hospital approval or proof of identity. Deleted words or files cannot be recovered from their fingerprints.
- **A limited text screen** (`src/guard.js`) blocks detected patterns in questions, posts, attachment names, voice captions, request/thread messages, reviewed questions and taught-note text/source labels. Pressing again does not override it. Blocked questions do not retrieve records or save their words or fingerprint. Text patterns miss other forms of identifying information and can flag benign text. Media and uploaded document contents are not inspected; the prohibition still applies.
- **The log** uses serialized writes so overlapping operations cannot fork the receipt chain. Question receipts include a question fingerprint, interpreted kind/date range, engine version, source references/versions and answer fingerprint, with no raw wording. Other recorded events cover changes and selected source opens, shares, exports and check requests; these record requests, not proof that an external transfer finished. Posts, source metadata and files have fingerprints. Files above 8 MiB use a SHA-256 chunk-manifest fingerprint covering every byte, explicitly distinct from SHA256(file bytes). Receipt-chain checks and retained-content checks are separate; old unrecorded/partial items and missing backup media are reported without claiming verification. Full receipt export is for the keeper. All local restrictions remain a courtesy until accounts exist.
- **Checkpoints** are complete 64-character fingerprints copied and retained independently. Validation checks the entire current chain and exact checkpoint membership, including entries after it. A middle deletion breaks a chain; a missing tail or whole replacement can look internally consistent until compared with an independently retained checkpoint. The exported log also has a standalone checker, `scripts/verify-receipts.mjs`. Current receipts/checkpoints are unsigned; they do not prove a human identity, trusted time or factual correctness.
- **Limits.** Names are selected profiles and times come from the device. A fingerprint can support an integrity comparison against a trusted receipt/checkpoint; it does not hide guessable input. The browser owner can replace all local state. Copies, operating-system screenshots and all file contents cannot be monitored by this app. Retention, server authentication, automated external checkpoints, alert review and approved document authority remain work for a shared deployment. Receipts and data still compete for browser storage.

### Version 10 integration review

Only the new Version 10 commit was applied to PR #2 at `060035c`; the three earlier patch commits were already there. Conflicts were resolved while retaining the prior record-preservation, date-handling, source-opening, viewer-refresh and phone-header fixes.

Review corrected taught-answer overrides of live or restricted lookups, lost night context, ambiguous staff-name correction, discarded negation/obligation, stale source feedback, repeated-press patient-screen bypass, partial large-file fingerprints and prefix-only checkpoint checks. It also made the scope and limitations of the notice accurate. "Who approves leave?" searches documents rather than listing today's staff. Attendance/calling in sick is not conflated with approved leave or low-census releases.

Independent validation: 78 Node tests, two launcher checks and both production builds pass. `scripts/check-ask-ui.cjs` runs the built local app in a simulated DOM using fictional data. It checks notice acknowledgement, transient/blocked question handling, repeated patient-text blocking, stable follow-ups, current source feedback and deletion, reviewed question storage, taught notes/aliases, profile changes, full chain/checkpoint validation and retained-content status. Its Ask flows made no external requests and preserved the fixture roster. This is not a real-browser or phone check; the real photos and the author's 361-assignment import were not independently rerun during this integration.

## Added on branch `claude/trade-finder`: ways off a shift, exchanges and trade questions

The owner's direction on 2026-11-11: trades that need more than two people usually come up midway through a week, only a couple of people ever help, and people's schedules are irregular, so finding one takes finesse. He wants calculators and logic built in, and the assistant made smarter with plain deterministic code, no language model. He asked for this to be built after two rounds of review.

- **The engine** (`src/trades.js`). A move hands one assignment to one person. An exchange is a list of moves that happen together or not at all. The whole exchange is applied and then every person in it is checked: two shifts at once, hours between shifts, weekly hours in every pay week touched, whether the person is listed on that kind of shift, and whether a charge or ICU shift goes to someone who has been listed as that. Moves that each fail alone can pass together, and the tests include that case.
- **Ways off a shift.** On your own shift, **Find ways off this shift** lists people who could pick it up, swaps with one person, three-person chains where someone can take yours only because a third person takes one of theirs, and, on request, three-person loops. Each option says who takes what, what it does to each person's weekly hours, and what needs checking. Only the simplest few of each kind are shown, with the count of how many passed.
- **It does not know who is willing.** The list is what the rules allow. **Shifts I could pick up** on the Requests tab lets a person say which shifts they are open to. Someone who said so is shown first for that shift. It is not a promise.
- **Exchanges.** Proposing an option creates an exchange. Nothing changes until every person in it has agreed, and it is checked again on the current schedule each time someone agrees. If it no longer passes it is closed as no longer possible. An agreed exchange holds its shifts so they cannot be offered twice, counts toward later checks, and is credited in the fairness record as a trade or as cover. It ends at "queued for review", like every other request.
- **Rules are settings.** Whoever keeps the record sets the day the pay week starts, the weekly hour limit, whether going over is refused or flagged, the hours between shifts and the most days in a row. Until someone does, the starting values apply and the app says they are not the department's confirmed rules. A change is recorded.
- **Ask.** "Who can take my Friday night", "I need Saturday off" and "can I pick up Friday night" are worked out with the same engine and say so. Answers offer next-step questions as buttons.

Limits: it works from the imported schedule, so handwritten changes, leave and pick-ups made elsewhere are not known. It does not check that a shift keeps enough people, only who holds charge and ICU. Qualifications are what is recorded, or else the kinds of shift the schedule lists a person on. Agreement is by whoever is selected under "Viewing as" until there are accounts, and nobody is notified. There is no list of shifts people want off, and nothing runs by itself when the schedule changes.

## Added on branch `claude/v12`: trades keep hours by default, and Ask reads ordinary schedule questions

The owner's correction on 2026-11-11, after using Version 11: a trade does not usually mean "who could cover". Most of the time the person wants to protect their weekly hours, and that gets harder as the week goes on. He also reported that Ask failed on his own schedule questions: "What days do I work the first week of December?" answered that he was not on the schedule.

- **Hours first.** The options for a shift are now ordered by what they do to weekly hours. First come swaps inside the same pay week, which change nobody's hours, then three-person exchanges inside the same pay week, which are found without asking. After those come swaps that move hours between weeks, and last the options where someone covers the shift and the person asking loses the hours. When nothing left in the pay week keeps everyone's hours, the sheet says so. Ask leads with cover only when cover is asked for.
- **Why Ask failed.** "Days" in "what days do I work" was read as the day shift, so a person who works nights was told they were not on the schedule. A month on its own, "the first week of December", "the 19th", "the week of Nov 15", "next month", "the next two weeks" and "the rest of this week" were not read as dates at all. All of these are read now, and the cases are in the tests.
- **New answers.** Days off ("am I off Friday", "what days am I off next week"), scheduled hours by pay week against the limit entered ("how many hours do I have this week"), weekend shifts only ("which weekends am I on"), and the count of shifts in any range.
- The lesson for testing: the questions that passed before were ones written by the person who wrote the code. The battery now used is closer to how people type, and it is still not a substitute for other people's questions.

## Version 12 integration review

The three new commits applied cleanly on main at `256e914`. The first removes employer initials from the current banner, sheet notice and documentation and replaces two test names with fictional ones. This does not rewrite Git history. No real schedules, contact numbers or employer documents were added.

Review bound pending exchange agreements to a fingerprint of the exact moves, participating rosters, recorded qualifications and rule settings. A correction or changed rule requires a fresh proposal and agreement; old unbound pending proposals are rejected. The check runs again during the serialized save. Shifts that already started today are excluded, and legacy two-person request screens now use the same whole-exchange checker as the finder. Consecutive-day settings are labelled as warnings, matching their behavior.

Ask now also retains explicit years for a named month's week, uses the configured pay-week boundary for hours questions, includes agreed assignments in hours totals and carries the target shift's week into a trade follow-up. Missing roster dates are unknown, not days off; day/night-specific questions keep their requested shift. Available dates alone do not establish a complete roster or verified absence.

Validation: 95 Node tests, two launcher integration checks and both production builds pass. The extended production-bundle simulated-DOM script checks the December wording, configured pay week, proposal fingerprint, stale agreement rejection, fresh multi-party agreement and projected reservations, alongside the earlier Ask/audit checks. Fixture roster preserved and no external requests in those flows. The public bundle is checked for the removed identifiers. These checks do not replay the author's real photos or establish the reported 29/29 or later 26-question results, and they are not real-phone checks. Footer remains Version 12.

## Still open from the review

- Matches that are blocked are hidden with no reason given.
- A date missing from an import is not detected, so weekly hours can be understated.
- Schedule names are checked against the rest of the batch. They are matched to the telephone list only after import.
- Import flags are cleared one at a time, and an unsupported layout offers no way to enter shifts by hand.
- Source images from an abandoned import stay in browser storage until the workspace is erased.
