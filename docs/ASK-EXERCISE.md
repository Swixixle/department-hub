# A voluntary exercise: ask it the way you would ask a person

This is a paper exercise. It is not a feature of the app, it is not required by anyone, and nothing is
collected by the app while it runs. Ask takes no part in it until the questions are already written down.

## Why it is on paper

Ask does not send questions anywhere, and the app does not routinely keep the text of a question. If
coworkers' questions were gathered by having them type into the app, the app would have to start keeping
them, which is the opposite of how it is built. So the wording is collected first, by hand, by whoever
is running the exercise, and only then tried against the app.

It is also honest about what it can and cannot show. One phone, one browser, one person's records is all
that exists today. A real department trial, where several people use their own accounts at the same time
and see the same records, needs the shared backend. That is not built yet. Until it is, this exercise can
tell you whether the words people actually use are understood. It cannot tell you whether the app works
for a department.

## What to hand out

One sheet per person, no name on it:

> The department schedule app has a question box. Write down the questions you would actually type into
> it — in your own words, with your own shorthand. Five is plenty. Do not try to write them the way you
> think a computer wants them; write them the way you would text a coworker.
>
> If it helps: a question about your own shifts, a question about someone else's, a question about a day
> or a weekend, a question about time off, and one thing you have actually needed to know at work.

That is the whole handout. No examples of "good" questions, because an example is a leading question: a
person shown "When do I work next?" writes variations of it, and then the exercise measures the example
rather than the person.

## What to do with the sheets

Type each question in exactly as written — spelling, shorthand, missing punctuation and all. Do not tidy
it up first. Record the result in one of four categories:

1. **Correct answer.** It answered the question that was asked, from the records, with the right date,
   person and shift. Check the "Understood as" line, not just the look of the reply: an answer that reads
   well about the wrong Friday belongs in category 4, not category 1.
2. **Useful clarification.** It did not answer, but it asked something narrow and answerable ("Which
   Friday do you mean, Fri, Nov 20 or Fri, Nov 27?"), or it named a supported question close to the one
   asked. The person can get to the answer in one more step.
3. **Unhelpful non-answer.** It said it did not understand, or said nothing was on record, and offered
   nothing that gets closer. Honest, but no use.
4. **Confidently wrong answer.** It produced a confident-looking answer to a different question — the
   wrong date, the wrong person, the wrong shift, or a document passage presented as if it answered a
   schedule question. This is the category that matters most. One of these is worse than ten of
   category 3, because the person has no reason to doubt it.

Count the four categories and keep the original wording of every question in categories 2, 3 and 4.
Those words are the work list.

## The rule about tuning

Measure the whole set once, before changing anything, and write the four counts down. Then fix what is
worth fixing and measure the same set again, reporting both numbers. A set that has already been tuned
against is no longer a test of anything: it only shows that the fixes were applied. If a second round is
wanted, it needs new sheets from people who have not seen the first round's results.

Developer-written test cases are not this exercise and must not be reported as though they were. The
tests in this repository were written by the people building the app, who know which words it recognises.
They prove the engine does what it was built to do. They prove nothing about whether a respiratory
therapist's own wording is understood.
