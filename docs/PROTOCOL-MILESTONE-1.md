# Protocol milestone 1: one complete, invented source

Status: implementation brief for the synthetic milestone. This release records the brief; it does not implement
the feature. Start from the merged main containing this file. Preserve other work on separate branches.

## Result

A person opens Protocols, browses an invented protocol, and asks a direct or conditional question. Ask returns a
reviewed, source-linked explanation containing the applicable rule, prerequisites, exceptions and escalation text.
The original is one tap away at each cited place. A replacement revision updates what is answerable without
erasing the older source. Keep Ask LLM-free and offline-capable.

Build this with fictional material now. Real hospital documents and their shared hosting are a separate decision;
do not wait for them or put any of them in Git, fixtures, CI artifacts or the public demo.

## 1. Build a source that can expose a wrong answer

Author a short fictional respiratory training protocol with two revisions. Label every page and fixture
“Synthetic test material — NOT FOR CLINICAL USE.” Include adult and pediatric sections, a numeric rule with an
explicit unit, an order requirement, a qualification requirement, a contraindication on a different page, a stop
condition, and an explicit escalation role. Include a table and one branching diagram. Pick deliberately fictional
training values, not an imitation of a hospital protocol or a clinical recommendation.

Commit the resulting source PDFs and expected extraction as fixed synthetic fixtures. Optional regeneration tools
must not become a new dependency of every normal build. Keep private files out of fixtures and logs.

## 2. Retain a versioned original and verified extraction

Represent a protocol family separately from its immutable revisions. Retain the original bytes, content digest,
issuing authority, protocol identifier, revision, effective date, category and source location. Record added/reviewed
times separately from the issuing organization's dates. A digest establishes a content identity, not approval.

Extract text from a text-based PDF locally, preserving page and block anchors. Show the original beside the
extraction for review, including table row/column context. Do not treat an empty extraction or unchecked OCR as a
success. Scanned-PDF recognition and automatic flowchart interpretation may remain explicitly unsupported in this
milestone; let the reviewer provide verified text and explicit branch links. They must never silently become an
answer-ready import. Benchmark any new parser's bundle size and parsing time, and document what it cannot read.

Use distinct states for added, extraction checked, answer mappings reviewed, active, superseded and withdrawn.
Preview material may be read while incomplete; ordinary protocol answers require an active reviewed revision.
Existing pasted documents remain readable and clearly identified as legacy search results. They do not silently
acquire reviewed-protocol status during an upgrade.

## 3. Bind a whole rule, not three independently ranked paragraphs

For this protocol, author an explicit answer bundle that links the rule to every required condition, prerequisite,
exception, stop condition and escalation passage. Each link names the revision digest and a page/block anchor.
Have an explicit review action for the bundle. The selected profile in the local prototype is not authenticated
clinical authority; describe that accurately.

Search may select a bundle or suggest a passage for review. Search score, repeated use and “Yes” feedback cannot
remove an exception, approve a bundle, change a rule or establish source precedence. Human-written plain language
is allowed when separately labelled and reviewed; keep the original wording alongside it.

Encode the difficult branches explicitly. Ask for a missing age band, order status or other required condition,
with “unknown” available. Do not assume a missing condition is false or true. These are transient, general
protocol conditions, not a new patient chart; no names or patient identifiers are needed or retained.

The answer should contain the interpretation, a short explanation, the rule and its conditions, required
orders/qualifications, exceptions/stops, escalation, and exact versioned citations. Do not truncate a mandatory
exception because it would be the fourth search result. An unanswered or conflicting case names what is unresolved
and shows the relevant sources. Do not invent precedence between two authorities.

## 4. Add Protocols to the interface

Provide a visible, labelled Protocols destination accessible from every main screen without shrinking the existing
phone targets. Reuse the document store and Ask shell where appropriate; do not create a disconnected second
library. Include browsing, search, a bookmark, original/extracted views, review status and revision history. Ask's
Open action must highlight the cited passage in the exact original revision, including historical answers.

Use the existing receipt/build conventions for imports, reviews, replacements and withdrawals. Preserve older
workspace data and receipts. Routine searches, branch choices and reading must not acquire named browsing logs or
automatic question-text storage. No external AI, sending service or patient-content upload is added.

## 5. Replacement and absence must change the result

When revision 2 becomes effective and active, revision 1 remains available as history but cannot supply an ordinary
current answer. Its answer bundles and learned wording cannot silently transfer to revision 2. Until revision 2's
bundle is reviewed, show its original with the pending-review state rather than falling back to an obsolete answer.
Test future-effective dates, withdrawal, no applicable revision and explicitly conflicting revisions. Label offline
results with the version held on that device; do not claim it is the hospital's latest without a verified feed.

## 6. Acceptance and delivery

Use assertions about returned content and source anchors, not just routing tags. Cover direct questions, common
misspellings, conditional follow-ups, missing facts, age bands, units, orders, qualifications, contraindications,
stopping/escalation, out-of-scope questions and version replacement. Add upgrade preservation and production-form
checks. The existing schedule, threshold, permission, build, receipt and launcher checks must continue to pass.

Run deliberate faults independently: remove the contraindication link, alter a unit, select the wrong age branch,
remove the order requirement and reuse a superseded revision. Each corresponding contract check must fail. Keep a
positive control returning a complete usable answer, so an implementation that refuses everything cannot pass.
Do not call developer-written tuned questions a holdout accuracy measurement or synthetic tests clinical validation.

Deliver separate reviewable commits for source/version storage, rule bundles/pathways, and the UI/integration.
Report exact checks, known limits and a short fictional walkthrough. No deployment, Mac installation, production
domain change, shared sign-in UI, real protocol import or selection of email's purpose is part of this milestone.
