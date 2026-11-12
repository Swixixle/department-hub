# Protocols: source-backed answers from the department's own documents

Recorded 2026-11-12. Product direction; implementation status is listed below.

## What the owner has decided

**Immediate, source-backed answers from the department's actual protocols are a central purpose of Department Hub**,
alongside the schedule, the board and trades. The case that matters most is the one with no superior around: a
question a supervisor would settle by consulting the written rules should be answerable from those same rules, with
the exact source one tap away.

A dedicated **Protocols** section should let people browse the same material Ask uses, and every answer should open
its exact source.

This is direction. Nothing in this file is built beyond what the next section lists.

## Where it stands, checked against main at `0f762bc`

| Area | State |
| --- | --- |
| Scheduling and comparisons | Working and tested; limited to supported questions |
| Shared accounts and storage | Server built and tested; no sign-in screen, no real-device test |
| Protocol library | A basic Documents list inside the Ask dialog |
| Protocol answers | Finds and quotes matching passages; no clinical interpretation is validated |

What the code does today, read rather than assumed:

- A document is pasted text or a `.txt`/`.md` file, with a title, a kind (Policy, Procedure, Protocol, Manual, Other)
  and an optional effective date. There is no PDF import, no page reference, no table or flowchart.
- A document has an internal record ID, but no issuing organization's protocol identifier, revision, issuing authority or current/replaced controls in the library. Replacing one means removing
  it and adding another; the old text is gone, not retired.
- Ask splits each document into paragraphs and ranks them independently. It returns up to three passages and links
  each to its place in the document.
- **It does not gather a rule, its exceptions and its prerequisites when they sit in different paragraphs.** A
  passage that says what to do can be returned without the paragraph that says when not to. This is the important
  gap, and it is a clinical one, not a search-quality one.
- Pressing "Yes, remember this wording" records relevance for that document version. It is not policy approval and
  the screen says so.

## What has to be built

1. **A proper Protocols section.** Browse by subject, search, bookmark, and open the original. PDF import that keeps
   page references, tables and flowcharts. A scanned document needs its extraction checked against the original
   before anything is answered from it.
2. **Control over which version applies.** Issuing authority, identifier, revision, effective date and
   current/replaced status. Adding a replacement retires the old version from ordinary answers and keeps its history.
3. **Answers that carry the whole rule.** What the protocol says to do; when that applies; required orders,
   qualifications or prerequisites; exceptions, stopping conditions and escalation; and the exact document, version
   and page.
4. **Reviewed pathways for difficult questions.** An important protocol is turned into explicit branches: ask the
   missing question, follow the applicable branch, return its reviewed instructions. This works without a language
   model. It needs each pathway translated and checked by a person, not keyword search expected to reason.
5. **Clinical tests, separate from language tests.** Cases proving a contraindication is retained, adult and
   pediatric instructions are told apart, units are handled correctly, order requirements are respected, and
   conflicting or missing guidance is identified. A fluent answer is not evidence that those parts survived.

## Rules that hold whatever gets built

- **The authority travels with the answer.** The current approved protocol supplies it. Uploading a document or
  pressing "Yes" does not turn anybody's interpretation into hospital policy.
- **Quote, then point.** An answer shows the protocol's own words and opens the source. Where the rules leave a
  judgment unresolved, the answer names the unresolved point and the documented escalation route. It does not fill
  the gap.
- **No language model and no outside service**, as everywhere else in Ask.
- **A reviewed pathway names its reviewer and the version it was reviewed against**, and stops applying when that
  version is replaced, exactly as a learned passage preference already does.
- **Real protocols never enter this repository, its tests or the public demo.** They are the employer's documents.
  Everything committed uses an invented protocol written for the purpose.

## Two things to settle before this goes far

**Whose documents these are.** Today a document stays in one browser. In the shared version it would sit on a server
the owner pays for and be readable by every member. Whether the hospital permits its protocols to be copied into a
personal app at all, and onto that server in particular, is the owner's question to put to whoever owns the
protocols. The software cannot answer it and should not be built as though it were answered.

**Intended use and clinical review.** The current [FDA CDS guidance](https://www.fda.gov/media/109618/download),
issued January 29, 2026, supersedes January 6. Section IV(4), printed pages 14–16, discusses independent review,
automation and urgency. Neither a source link nor a quick response establishes a regulatory classification;
the actual intended use and implementation need assessment before clinical deployment.

Build source-linked protocol explanations with the applicable conditions, exceptions and escalation route visible.
Do not invent instructions or orders. Fast access to the original protocol remains part of the goal; do not turn a
secondhand regulatory summary into a blanket ban on useful reference access. The synthetic milestone establishes
software behavior, not clinical validation or hospital approval. A designated clinical reviewer and document owner
must assess real content and its intended use before a clinical pilot. These review requirements do not block
building and testing the invented-protocol milestone.

## The first milestone

**One complete protocol, end to end**, before a second is added: the original document, a verified extraction,
direct questions, the difficult branches, the exceptions, and replacement by a newer version. Done with an invented
protocol in the repository so the whole path can be tested in public, and repeatable with a real one on the owner's
own device.

The concrete implementation brief is [PROTOCOL-MILESTONE-1.md](PROTOCOL-MILESTONE-1.md). It does not enable a
clinical deployment, select email's purpose or deploy the shared backend.

It is done when, for that one protocol:

- a direct question returns the instruction **with** the condition it applies under and the exceptions to it, drawn
  from wherever in the document they sit;
- every part of the answer opens the exact place in the exact version;
- a question the protocol does not settle says so and gives the escalation route the protocol names;
- a question that depends on a missing fact (adult or pediatric, with or without an order) asks for it instead of
  choosing;
- replacing the protocol with a new revision changes the answers, retires the old pathway, and keeps the old version
  readable as history;
- the clinical tests fail if a contraindication, a unit, an age band or an order requirement is dropped — checked
  the way the permission gate is, by removing each on purpose and requiring the tests to notice.
