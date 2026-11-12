# Version 17

Ask now supports a strict threshold against one named person's figure: “Who has more weekend day shifts than
Casey?” It reports both matching people and Casey's reference figure. Shift, role, period, exclusions and ranking
limits apply, including ties at a limit. A named two-person comparison remains a comparison; a fair-share question
keeps its existing metric.

Integration review corrected direction for “behind,” prevented an exclusion from replacing an unknown reference,
applied ranking limits and allowed an explicit reference correction. A second boundary or a negated threshold is
recognized as unsupported and returns a clarification rather than an answer with that constraint omitted. A
shift-only follow-up cannot erase the unresolved constraint. These limits are explicit; this is not general
English understanding. Numerical thresholds and compound boundaries are not added by this release.

The three developer-written eval sets are maintained regressions, not an independent language-accuracy sample.
Result-level tests and real-HTTP/production-form permission checks accompany the planner labels.

Protocol answers are recorded as a central product purpose. [PROTOCOLS.md](PROTOCOLS.md) explains the goal and
current limits; [PROTOCOL-MILESTONE-1.md](PROTOCOL-MILESTONE-1.md) gives the invented-protocol build brief. The
Protocol destination, PDF reader, answer bundles and reviewed pathways described there are not implemented here.

Source and the fictional demo advance to Version 17. The installed standalone folder is not updated automatically.
The app still uses local browser storage; shared sign-in screens, connected shared UI, production deployment and
physical-phone validation remain outstanding. Email's purpose remains open, and no app-sent email/SMS is added.
