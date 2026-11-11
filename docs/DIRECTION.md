# Direction after the handoff

Recorded 2026-11-10 from the owner's conversation with Claude. Read this after `CLAUDE-HANDOFF.md`. Where the two differ, this file is newer.

## What the owner has decided

- **The schedule is the way in.** A coworker opens a link and sees their own shifts and who they work with. The board and conversations grow out of schedule activity.
- **Staff-run companion.** The employer's official scheduling and timekeeping system stays the source of truth. This app holds a dated copy of the schedule and helps people coordinate. It never claims to approve or confirm anything.
- **Phone and touch first.** Tap a shift and it highlights. A short action sheet opens with the few things you can do.
- **A scrolling department board** where schedule events appear as posts next to ordinary posts.
- **Fairness tracking.** Keep track of seniority, call-offs, pickups and trades so that imbalances can be evened out on the next schedule. Seniority means time in the department.
- **Check-ins at the middle and end of each schedule**, because by the end of a schedule most of what happened is forgotten. Schedules run about three months.
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
- **Order of work.** Eligibility fixes (done, below), the real schedule layout, the phone view with the shift action sheet, then shared accounts and the board.

## Fixed on branch `claude/fix-eligibility-checks`

All three were reproduced in the public demo before the fix and checked again in a browser afterwards.

- **A shift could be agreed twice.** Agreed requests now reserve their shifts, a second acceptance is blocked on recheck with the reason shown, and the shift's own dialog links to the agreed request. Sending the same request twice is refused.
- **Agreed changes did not count toward hours.** Checks now run against the roster with agreed requests applied, so an agreed pickup counts toward overtime, overlap and rest before it reaches the official system.
- **Unknown staff details skipped the roster checks.** Overlap, rest and overtime checks now always run. Unknown details only lower the result to "needs verification". The same shift went from 40 listed matches to 10.
- **Back-to-back shifts passed as eligible.** A new starter rule, `minimumRestMinutes`, blocks a change that puts a night and a day back to back. The value is illustrative, like the other starter rules. The rule version is now `pilot-2`, and saved workspaces pick it up on load.

## Still open from the review

- Matches that are blocked are hidden with no reason given.
- A date missing from an import is not detected, so weekly hours can be understated.
- Names are not checked against a staff list, so a misread name becomes a new person.
- Import flags are cleared one at a time, and an unsupported layout offers no way to enter shifts by hand.
- Source images from an abandoned import stay in browser storage until the workspace is erased.
- Exported receipts have no checker.
