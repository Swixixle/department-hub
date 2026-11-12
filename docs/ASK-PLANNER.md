# How Ask reads a comparison question

## The question that made this necessary

> Who has the most weekends on day shift, other than Avery?

Ask answered that with who is on today. The ranking, the shift filter and the exclusion were all dropped, and what
came back was a confident answer to a question nobody asked. The grammar of the sentence was not the problem. The
problem was that Ask had no way to hold "most", "on day shift" and "other than Avery" at the same time: it matched a
question against a list of keywords, took the first kind that fitted, and threw the rest away.

Adding a pattern for that sentence would have fixed that sentence. So the structure changed instead.

## The stages, kept apart on purpose

```
1  what was typed            the question, untouched
2  normalise                 shorthand spelled out, a misspelling moved to the nearest word the app knows
3  recognise the parts       people, dates, an operation, a metric, filters, exclusions
4  a typed plan              src/plan.js — with anything it could not represent named, not dropped
5  repair                    a follow-up edits the plan's fields; it does not start again
6  permission                other people's figures are the record keeper's, whatever the question says
7  execute                   src/measure.js — counting only, over the records the asker may see
8  words                     the answer, and an "Understood as" line written from the plan
```

Two rules hold it together.

**A recognised constraint is never silently dropped.** If the plan cannot represent something the question clearly
asked for, the answer is a clarification naming what it could not do. It is never an easier question answered
confidently. "Who has the most weekends per month?" is refused, because a rate per month is not something the app
can work out, and answering with a plain count would look like an answer and be about something else.

**The "Understood as" line is written from the plan**, so it says what actually ran. A nicer sentence is not evidence
that the right query ran, and the only way to tell from outside is to see the plan in words.

## What the plan holds

```js
{ op: 'rank' | 'compare' | 'count' | 'threshold',
  metric: 'weekend-shifts' | 'distinct-weekends' | 'weekend-fair-gap' | 'shifts' | 'hours' | 'charge-turns' | 'icu-turns' | 'holidays',
  direction: 'highest' | 'lowest',
  limit: 3,                       // "the top three"
  shift: 'D' | 'N' | null,
  role: 'charge' | 'icu' | null,
  people: ['Blair', 'Casey'],     // for a comparison between named people
  than: 'Casey',                  // for a threshold: the one figure everybody else is measured against
  exclude: ['Avery'],
  when: { from, to, label } | null,
  ties: true,
  unsupported: ['a rate per month, week, year or shift'],
  unresolved: ['zephyrine'] }     // a name the question asked to leave out that matches nobody
```

These are parts that combine. One more kind of question is one more value, not one more branch: the same machinery
answers the fewest, the top three, a comparison between two people, a month, a role, several exclusions, and a
follow-up that changes any of those.

## Four operations, and the line between two of them

| Operation | The question | What comes back |
| --- | --- | --- |
| rank | who has the most weekends on day shift | the top (or bottom), ties together |
| compare | who has more weekend day shifts, Blair or Casey | the two named people, and which leads |
| count | how many separate weekends does each person have | every person's figure, nobody singled out |
| threshold | who has more weekend day shifts than Casey | everybody past Casey, and Casey's own figure as the mark |

**"more than" was in the build brief's list of things that must never be silently dropped, and it was being dropped.**
The planner did not claim a threshold question at all, so it fell through to the ordinary routing, and *"does anyone
have more weekend day shifts than Blair"* came back as *"Blair has 1 shift this weekend"* — a confident answer to a
different question, with the metric word "weekend" eaten as a date on the way out. That is now its own operation.

The line between a comparison and a threshold is which side the question names:

- An open subject — "**who** has more than Blair", "**does anyone** beat Blair" — names only the mark. A threshold.
- A named near side — "**do I** work more weekends than Blair", "**does Morgan** do more than Jordan" — names both
  sides. A comparison.

"More than their fair share" is not a threshold either: there is no person being measured against, because "more
than their share" *is* the metric. All three of those distinctions were got wrong on the first attempt and found by
the evaluation sets rather than by thinking about it harder.

A threshold reports the mark's own figure alongside the names. A list of people who beat Casey, without the number
they had to beat, is not an answer.

Integration review additionally checks the returned figures, not just plan labels. “Behind” selects fewer,
an unknown reference cannot be replaced by a later excluded name, and a ranking limit is executed with its ties.
An explicit “no, fewer than Casey” changes the reference while retaining the other fields. This version supports
one strict person reference. Multiple references/boundaries and a negated threshold are recognized as unsupported;
they ask for clarification instead of dropping a condition. A shift-only follow-up cannot erase that unresolved
condition. Numerical thresholds and compound comparisons are not claimed as implemented.

## Metrics that are not the same question

Three of these are routinely confused, so each is counted separately and the answer says which one it used.

| Metric | What it counts | Why it differs |
| --- | --- | --- |
| weekend shifts | shifts that fall on a weekend turn | a Saturday and a Sunday are **two** |
| distinct weekends | weekends touched at all | a Saturday and the Sunday after it are **one** |
| weekend turns above or below a fair share | the gap between a person's weekend turns and their share | somebody who works twice as many shifts has twice the share, so the ranking is different again |

The app's existing definitions are the authority for all of it. A weekend turn is `isWeekendTurn` from
`src/fairness.js`, where a night shift counts from Friday. A fair share is the fairness ledger's, because that is the
only thing that knows how a share is worked out. `src/measure.js` adds no second opinion about either.

A fair share is worked out within one shift pool, so a question about it that names no shift asks which one rather
than mixing day and night into a number that means nothing.

## Permission

Reading the question correctly is not permission to answer it. A ranking or a comparison that involves anybody other
than the asker needs the record keeper, exactly as the fairness record does everywhere else in the app. A person who
is not the keeper gets the same refusal they already got — and the "Understood as" line as well, so they can see the
question was understood and declined rather than misread.

## The English-library spike, and what it measured

The review recommended [Compromise](https://github.com/spencermountain/compromise/blob/master/docs/concepts.md) as
the first local English-processing candidate. It was installed at 14.20.0 in a throwaway probe, never in the app, and
measured rather than assumed.

**Cost.** 333 KB raw, **145 KB gzipped**, 127 KB brotli. The whole application bundle today is 197 KB raw, so
Compromise alone would be about 1.7 times the app. Import and initialise took **264 ms** and the first parse a
further **46 ms** on the machine this was measured on — a fast Linux container, with no phone anywhere near it; a
mid-range phone would be some multiple of that, which is an expectation and not a measurement. A warm parse is
0.57 ms, which is nothing.

**What it would buy.** The fourteen questions the planner missed on its first evaluation run were put through
Compromise to see what its grammar gave:

- `#Superlative` as a tag class: "busiest", "furthest", "most", "fewest" all come back tagged, instead of being
  listed one by one. This is the real win, and it generalises to superlatives nobody thought of.
- Noun-phrase heads: `nouns()` returns "their fair share", "their weekend share", "the day staff", "each person".
  Matching the head noun of a possessive phrase handles the share phrasings without enumerating variants.
- Verb lemmas: "worked" to "work", and the verb "order" told apart from the noun. Modest; the app already stems.
- It got "compare" wrong, tagging it a noun and swallowing "compare Blair and Casey" into a single noun phrase.
- It knows nothing about which words mean a shift, a weekend turn or a fair share, which is most of the work.

**What the misses actually were.** Of the six on the second evaluation set, four were a word not on a list — "skip"
as an exclusion, "per shift" as a rate, "proportion", "busyest" misspelled. Compromise fixes none of those. One,
"trending", its lemmatiser would have caught. One, "shortest of their share", its noun phrases would have helped
with. **One or two of six, for 145 KB.**

**The recommendation: not yet.** The structural change was the thing that mattered and it is done. The two things
Compromise genuinely provides are a superlative class and noun-phrase heads, and both were obtained here for a few
lines of regular expression. On a phone-first app that has to load fast and work offline, doubling the bundle for
one or two misses in six is not a trade worth making today.

**What would change that.** If the planner starts needing to understand sentence structure rather than vocabulary —
nested clauses, "everyone who worked more than Blair did in a month where Casey was off" — the regular expressions
will run out, and that is the point to adopt a grammar library rather than keep extending them. The spike is
reproducible: `npm install compromise@14.20.0` in a scratch directory, and the numbers above. Nothing was added to
the application's dependencies.

## Measuring it honestly

```sh
npm run eval:ask                    # both sets
npm run eval:ask -- set-b --show    # one set, with what each question was read as
```

`tests/eval/set-a.json` (63 questions) and `set-b.json` (48) label each question with the plan fields it should
produce, and the scorer reports the four categories the coworker exercise uses: correct answer, useful
clarification, unhelpful non-answer, confidently wrong answer. A confidently wrong answer fails the run.

The numbers that mean something are the first ones, before anything was changed in response to the set:

| | first run | after the fixes it prompted |
| --- | --- | --- |
| set A, 63 questions | **49 correct, 2 confidently wrong** | 63 correct, 0 wrong |
| set B, 48 questions, written after set A's fixes | **42 correct, 2 confidently wrong** | 48 correct, 0 wrong |
| set C, 18 questions, written for the threshold operation | **17 correct, 0 confidently wrong, 1 non-answer** | 18 correct, 0 wrong |

Each set has now been tuned against, and after that a set reports whether a fix held, not how good the engine is. A
new measurement needs a new set. The two serious misses on set B were both the dangerous kind — a constraint
silently dropped — and both were a missing word rather than a missing idea. Set C's one miss was "who is above
Casey on weekend day shifts": a threshold written without the word "than".

### A gap in the labels, and what it cost

The compare cases in sets A and B originally labelled the operation, the metric and the people, **but not the
direction**. So when the direction was read as "highest" whatever the question said — "who has fewer shifts, Emery
or Indigo" naming the one with more — the scorer passed it, and the bug was found by review instead. A label that
does not check a field cannot catch a fault in it.

Every compare case now labels its direction, and adding those labels immediately paid for itself: it caught three
cases where the new threshold operation had taken over questions that were comparisons. The lesson generalises past
this file — a test that asserts less than it could is the thing that lets a fault through while reporting green.

**What none of this measures.** Both sets were written by whoever wrote the engine, who knew which words it
recognises. They show that a stated constraint survives into the plan. They show nothing about whether a respiratory
therapist's own wording is understood. That is what `docs/ASK-EXERCISE.md` is for, and it needs coworkers and paper,
not more test files.
