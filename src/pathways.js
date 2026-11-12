// From a question to a reviewed protocol answer, without a language model and without the network.
//
// The steps are fixed. Decide whether the question is about a protocol that is held. Find the revision in force
// today, or say why there is none. Pick the topic the question names. Ask for any fact the rule turns on, with
// "Not known" always offered. Then return the one mapped answer that fits, whole, or every answer that could fit
// when something is not known. A question this cannot place is handed back to the rest of Ask untouched.
//
// Facts given here (an age band, whether an order exists) describe a general situation for the length of one
// conversation. They are not a patient record: no name or identifier is asked for, and nothing is stored.
import { keywords, stem, nearest, CORE_WORDS } from './words.js';
import { applicable, historyOf, searchLibrary, shortDigest, standing, STANDING } from './protocols.js';
import { resolve, wholeRule, reviewHolds, ROLES, UNKNOWN } from './bundles.js';

const NOT_KNOWN = 'Not known';
const UNSURE = /^(?:not known|unknown|not sure|unsure|no idea|i (?:do not|don'?t|dont) know|(?:do not|don'?t|dont) know|can(?:no|')?t tell)$/;
const ABOUT_RULES = /\b(?:protocols?|procedures?|polic(?:y|ies)|guidelines?|rules?)\b/;
const COMMON = new Set(CORE_WORDS);
const words = text => String(text || '').toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9'/-]+/g, ' ').trim().split(' ').filter(Boolean);
const stems = text => words(text).map(word => stem(word.replace(/'/g, '')));
const has = (sequence, phrase) => { const wanted = stems(phrase); return wanted.length > 0 && sequence.some((_, at) => wanted.every((word, offset) => sequence[at + offset] === word)); };
const say = list => list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list.at(-1);

// The words that mean "this protocol": its identifier, the distinctive words of its title, and any the mapping adds.
const subjectOf = (family, revisions) => [...new Set([family.identifier, ...revisions.flatMap(revision => [...(revision.subject || []), ...keywords(revision.title).filter(word => word.length >= 5 && !COMMON.has(word))])].map(text => text.toLowerCase()))];

// A word typed nearly right is read as the protocol's word, and the change is shown with the answer.
function tidy(question, vocabulary) {
  const known = new Set(vocabulary.flatMap(phrase => words(phrase)).filter(word => word.length >= 5)), knownStems = new Set([...known].map(stem)), changes = [];
  const text = words(question).map(word => {
    if (word.length < 5 || /\d/.test(word) || known.has(word) || knownStems.has(stem(word)) || COMMON.has(word)) return word;
    const fixed = nearest(word, known);
    if (fixed && fixed !== word) { changes.push([word, fixed]); return fixed; }
    return word;
  }).join(' ');
  return { text, changes };
}

function readFacts(sequence, facts, needs) {
  const found = {};
  for (const name of needs || []) {
    const said = (facts[name]?.options || []).filter(option => (option.said || []).some(phrase => has(sequence, phrase)));
    // "adult or pediatric" names both, which settles nothing.
    if (said.length === 1) found[name] = said[0].value;
  }
  return found;
}

function replyTo(pending, raw, sequence, fact) {
  const typed = raw.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (typed === NOT_KNOWN.toLowerCase() || UNSURE.test(typed)) return UNKNOWN;
  const byLabel = fact.options.find(option => option.label.toLowerCase() === typed || option.value === typed);
  if (byLabel) return byLabel.value;
  const said = fact.options.filter(option => (option.said || []).some(phrase => has(sequence, phrase)));
  if (said.length === 1) return said[0].value;
  const yes = /^(?:yes|yeah|yep|there is|it is)\b/.test(typed), no = /^(?:no|nope|there is not|there isn'?t|none)\b/.test(typed);
  if (yes || no) return fact.options.find(option => option.value === (yes ? 'yes' : 'no'))?.value || null;
  return null;
}

const citation = revision => revision.identifier + ' revision ' + revision.label + ', effective ' + revision.effective + ', file ' + shortDigest(revision.digest);
const held = revision => citation(revision) + ', as held on this device. Department Hub cannot tell whether whoever issued it has published a newer one.';
const open = (revision, anchor = '') => 'protocol|' + revision.id + '|' + anchor;
const factLine = (revision, topic, facts) => (topic.needs || []).filter(name => name in facts).map(name => facts[name] === UNKNOWN ? revision.facts[name].name + ': not known' : revision.facts[name].options.find(option => option.value === facts[name])?.label);
const passageItem = (revision, passage, label) => ({ text: passage.text, role: passage.role || null, anchor: passage.anchor, page: passage.page,
  sub: [label, revision.identifier + ' rev ' + revision.label, 'page ' + passage.page, passage.context, passage.supplied ? 'typed in by a reviewer from the original' : ''].filter(Boolean).join(' · '), go: open(revision, passage.anchor) });

// Outside a reviewed answer, protocol text is never quoted: a passage on its own can leave out the condition that
// forbids it. What is offered instead is the place, one tap from the original.
const pointers = (hits, revision) => [...new Map(hits.filter(hit => hit.passage.kind !== 'heading').map(hit => [hit.passage.page + '|' + (hit.passage.under || ''), hit])).values()].slice(0, 3).map(hit => ({
  text: 'Page ' + hit.passage.page + (hit.passage.under ? ' · ' + hit.passage.under : ''), sub: 'A place in the original that mentions this · ' + revision.identifier + ' rev ' + revision.label + ' · not quoted here, open it to read',
  go: open(revision, hit.passage.anchor), anchor: hit.passage.anchor, page: hit.passage.page }));

export function protocolAnswer(question, world) {
  const library = world.protocols, today = world.today, last = world.last?.protocol || null;
  if (!library?.families?.length || !String(question || '').trim()) return null;

  // What each held protocol answers to today.
  const candidates = library.families.map(family => {
    const now = applicable(library, family.id, today), revisions = historyOf(library, family.id).filter(revision => revision.state !== 'withdrawn');
    const source = now.revision, topics = now.answerable ? source.topics || [] : [];
    // A protocol held with nothing mapped to it yet is recognised by two of its own words ("bellows drill"), not one ("fire drill").
    // Every wording any held revision was mapped with, used only to recognise that a question is about this protocol
    // when no revision can answer today. Recognising a question is not answering it.
    const everHeld = historyOf(library, family.id), known = everHeld.flatMap(revision => [...(revision.topics || []).flatMap(topic => [topic.title, ...(topic.said || [])]),
      ...Object.values(revision.facts || {}).flatMap(fact => fact.options.flatMap(option => option.said || []))]);
    return { family, now, revisions, topics, known, subject: subjectOf(family, everHeld),
      vocabulary: [...topics.flatMap(topic => [topic.title, ...(topic.said || [])]), ...Object.values(now.answerable ? source.facts || {} : {}).flatMap(fact => fact.options.flatMap(option => option.said || [])), ...known] };
  });
  const read = tidy(question, candidates.flatMap(candidate => [...candidate.subject, ...candidate.vocabulary])), sequence = stems(read.text);
  const result = (candidate, body) => ({ kind: 'protocol', empty: false, lines: [], items: [], next: [], read: read.changes.length ? read.text : '', changes: read.changes, ...body,
    context: { kind: 'protocol', protocol: { family: candidate.family.id, ...(body.keep || {}) } } });

  // A reply to the question Ask put last turn.
  let chosen = null, topic = null, facts = {}, replied = false;
  if (last?.pending) {
    const candidate = candidates.find(entry => entry.family.id === last.family), source = candidate?.now.revision;
    const pendingTopic = candidate?.now.answerable && source.digest === last.revision ? source.topics.find(entry => entry.id === last.topic) : null;
    if (last.pending === 'topic' && candidate?.now.answerable) {
      const picked = candidate.topics.filter(entry => entry.title.toLowerCase() === question.trim().toLowerCase() || has(sequence, entry.title));
      if (picked.length === 1) { chosen = candidate; topic = picked[0]; facts = { ...last.facts }; replied = true; }
    } else if (pendingTopic) {
      const value = replyTo(last.pending, question, sequence, source.facts[last.pending]);
      if (value) { chosen = candidate; topic = pendingTopic; facts = { ...last.facts, [last.pending]: value }; replied = true; }
    }
  }

  if (!replied) {
    const scored = candidates.map(candidate => {
      const subject = candidate.subject.filter(phrase => has(sequence, phrase)).length, named = has(sequence, candidate.family.identifier);
      const topics = candidate.topics.map(entry => ({ entry, score: [entry.title, ...(entry.said || [])].filter(phrase => has(sequence, phrase)).reduce((sum, phrase) => sum + stems(phrase).length, 0) })).filter(hit => hit.score > 0)
        .sort((a, b) => b.score - a.score);
      const source = candidate.now.answerable ? candidate.now.revision : null, given = source ? readFacts(sequence, source.facts || {}, Object.keys(source.facts || {})) : {};
      const following = last?.family === candidate.family.id && !subject;
      return { candidate, subject, named, topics, given, following,
        taken: (subject > 0 && (topics.length > 0 || Object.keys(given).length > 0 || named || ABOUT_RULES.test(read.text) || (!candidate.now.answerable && (candidate.known.length ? candidate.known.some(phrase => has(sequence, phrase)) : subject >= 2)))) ||
          (following && (topics.length > 0 || Object.keys(given).length > 0)) };
    }).filter(entry => entry.taken).sort((a, b) => b.subject - a.subject || (b.topics[0]?.score || 0) - (a.topics[0]?.score || 0));
    if (!scored.length) return null;
    // Two protocols fit equally. Naming one would be inventing a precedence between them.
    if (scored.length > 1 && scored[0].subject === scored[1].subject && (scored[0].topics[0]?.score || 0) === (scored[1].topics[0]?.score || 0)) {
      return result(scored[0].candidate, { title: 'More than one protocol could be meant', understood: 'a question that fits more than one protocol', status: 'which-protocol',
        lines: ['Department Hub does not choose between them. Name the one you mean.'],
        items: scored.map(entry => ({ text: entry.candidate.family.identifier + ' · ' + (entry.candidate.now.revision || entry.candidate.revisions[0])?.title, sub: entry.candidate.now.why || 'Revision ' + entry.candidate.now.revision.label + ' in effect', go: 'protocol-family|' + entry.candidate.family.id })) });
    }
    const top = scored[0];
    chosen = top.candidate;
    const source = chosen.now.revision, sameRevision = Boolean(source) && last?.family === chosen.family.id && last.revision === source.digest;
    // A follow-up continues the protocol in hand and keeps what was already said about the situation: one that names
    // no protocol ("when do I stop?"), or one that only changes a fact ("and for a child?"). A question that names
    // the protocol and a topic again starts clean.
    const carry = sameRevision && (top.following || !top.topics.length);
    facts = { ...(carry ? last.facts : {}), ...top.given };
    if (top.topics.length > 1 && top.topics[0].score === top.topics[1].score) topic = null;
    else topic = top.topics[0]?.entry || (carry && Object.keys(top.given).length && last.topic ? source.topics.find(entry => entry.id === last.topic) : null) || null;
  }

  const { family, now } = chosen, revision = now.revision;
  const about = family.identifier + (revision ? ', ' + revision.title : '');
  // No revision can answer today. Say exactly why and point at what is held; never reach back to an earlier revision.
  if (!now.answerable) {
    const sources = (now.conflict || (revision ? [revision] : chosen.revisions.length ? chosen.revisions : historyOf(library, family.id))).map(entry => ({ text: entry.title + ' · revision ' + entry.label + ' · effective ' + entry.effective,
      sub: STANDING[standing(library, entry, today)] + ' · file ' + shortDigest(entry.digest) + ' · open the original', go: open(entry) }));
    const places = revision ? pointers(searchLibrary({ ...library, families: [family] }, read.text, today), revision) : [];
    return result(chosen, { title: { pending: 'No reviewed answer yet for the revision now in effect', conflict: 'Two revisions claim the same date', 'not-yet': 'No revision is in effect yet', none: 'No revision is held' }[now.status],
      understood: 'a question about the protocol ' + about, status: now.status, lines: [now.why], items: [...sources, ...places],
      source: revision ? held(revision) : 'Department Hub answers only from a revision that is in effect, checked and reviewed.',
      protocol: { status: now.status, family: family.id, identifier: family.identifier, revision: revision ? { id: revision.id, label: revision.label, digest: revision.digest, effective: revision.effective, state: revision.state } : null,
        conflict: (now.conflict || []).map(entry => entry.digest), sections: [], unresolved: [] } });
  }

  const others = chosen.topics.filter(entry => entry.id !== topic?.id).map(entry => entry.title);
  const base = { status: 'active', family: family.id, identifier: family.identifier, revision: { id: revision.id, label: revision.label, digest: revision.digest, effective: revision.effective, state: revision.state }, upcoming: now.upcoming ? { label: now.upcoming.label, effective: now.upcoming.effective } : null };
  const notice = now.upcoming ? ['Revision ' + now.upcoming.label + ' takes effect on ' + now.upcoming.effective + '. Until then this is from revision ' + revision.label + '.'] : [];
  if (!topic) {
    const places = pointers(searchLibrary({ ...library, families: [family] }, read.text, today), revision);
    return result(chosen, { title: chosen.topics.length ? 'No reviewed answer covers that. Which of these did you mean?' : 'No reviewed answer covers that', understood: 'a question about the protocol ' + about, status: 'uncovered',
      lines: ['Nothing reviewed in ' + citation(revision) + ' answers this.' + (places.length ? ' These places in the original mention it. They are not quoted here, because a passage on its own is not the rule.' : ''), ...notice], items: places, next: chosen.topics.map(entry => entry.title),
      source: held(revision), keep: { revision: revision.digest, facts, pending: chosen.topics.length ? 'topic' : undefined }, protocol: { ...base, status: 'uncovered', sections: [], unresolved: [] } });
  }

  // A fact the rule turns on has not been given. Ask for it; do not guess it.
  const missing = (topic.needs || []).find(name => !(name in facts));
  const keep = { revision: revision.digest, topic: topic.id, facts };
  const understood = 'the protocol ' + about + ': ' + topic.title.toLowerCase();
  if (missing) {
    const fact = revision.facts[missing];
    return result(chosen, { title: fact.ask, understood, status: 'asking', lines: ['The answer depends on this. Choose “' + NOT_KNOWN + '” if you cannot tell. Nothing is assumed, and this is not saved.'],
      next: [...fact.options.map(option => option.label), NOT_KNOWN], source: held(revision), keep: { ...keep, pending: missing }, protocol: { ...base, status: 'asking', topic: topic.id, asking: missing, facts, sections: [], unresolved: [] } });
  }

  const found = resolve(revision, topic, facts), given = factLine(revision, topic, facts);
  const reviewed = bundle => 'Answer reviewed here by ' + bundle.review.by + ' on ' + bundle.review.at.slice(0, 10) + ', under the profile selected on this device. That is not an authenticated clinical sign-off.';
  const sectionsOf = bundle => wholeRule(revision, bundle);
  const itemsOf = bundle => sectionsOf(bundle).flatMap(section => section.passages.map(passage => passageItem(revision, passage, section.heading)));
  // What a follow-up could change: the other choices of each fact, and the other topics.
  const turns = (topic.needs || []).flatMap(name => revision.facts[name].options.filter(option => option.value !== facts[name]).map(option => option.label));

  if (found.kind === 'answer') {
    const bundle = found.bundle;
    return result(chosen, { title: bundle.plain.interpretation, understood, status: 'answer', keep,
      lines: [...(given.length ? ['For: ' + given.join(' · ')] : []), ...(bundle.plain.explanation ? [bundle.plain.explanation] : []),
        'The lines above are a plain-language summary written by a person and reviewed against the original. The protocol’s own words follow, each with its place in the original. They are what counts.', ...notice],
      items: itemsOf(bundle), next: [...turns, ...others].slice(0, 4), source: held(revision) + ' ' + reviewed(bundle),
      protocol: { ...base, status: 'answer', topic: topic.id, bundle: bundle.id, facts, interpretation: bundle.plain.interpretation, explanation: bundle.plain.explanation || '', sections: sectionsOf(bundle), unresolved: [] } });
  }
  if (found.kind === 'unresolved') {
    const naming = found.unknown.map(name => revision.facts[name].name);
    const branchLabel = bundle => Object.entries(bundle.when || {}).filter(([name]) => facts[name] === UNKNOWN).map(([name, value]) => revision.facts[name].options.find(option => option.value === value).label);
    return result(chosen, { title: 'This depends on ' + say(naming) + ', which ' + (naming.length === 1 ? 'is' : 'are') + ' not known', understood, status: 'unresolved', keep,
      lines: [...(given.length ? ['For: ' + given.join(' · ')] : []), 'Nothing is assumed. Each possibility is shown whole, with everything that goes with it.', ...notice],
      items: found.bundles.flatMap(bundle => [{ text: 'If ' + say(branchLabel(bundle)) + ': ' + bundle.plain.interpretation, sub: 'Plain-language summary, reviewed. The protocol’s own words follow.', branch: bundle.id }, ...itemsOf(bundle).map(item => ({ ...item, branch: bundle.id }))]),
      next: found.unknown.flatMap(name => revision.facts[name].options.map(option => option.label)).slice(0, 4), source: held(revision) + ' ' + reviewed(found.bundles[0]),
      protocol: { ...base, status: 'unresolved', topic: topic.id, facts, unresolved: found.unknown, branches: found.bundles.map(bundle => ({ bundle: bundle.id, when: bundle.when, interpretation: bundle.plain.interpretation, sections: sectionsOf(bundle) })), sections: [] } });
  }
  // A mapped answer exists for this case and nobody has reviewed it, or none was written. Point at the source; give no rule.
  const waiting = found.kind === 'unreviewed';
  return result(chosen, { title: waiting ? 'An answer is mapped for this and has not been reviewed' : 'No reviewed answer covers this case', understood, status: waiting ? 'unreviewed' : 'uncovered', keep,
    lines: [...(given.length ? ['For: ' + given.join(' · ')] : []), waiting ? 'Until a person reviews it against the original it is not shown. Open the protocol and read the passages it would rest on.' : 'Open the protocol and read it; nothing mapped fits these facts.', ...notice],
    items: [{ text: revision.title + ' · revision ' + revision.label, sub: STANDING[standing(library, revision, today)] + ' · open the original', go: open(revision) },
      ...(waiting ? found.bundles.flatMap(bundle => bundle.links.filter(link => link.role === 'rule').map(link => ({ text: 'Page ' + link.anchor.match(/^p(\d+)/)[1], sub: 'Where the unreviewed answer points. Read it in the original.', go: open(revision, link.anchor) }))) : [])],
    next: turns.slice(0, 4), source: held(revision), protocol: { ...base, status: waiting ? 'unreviewed' : 'uncovered', topic: topic.id, facts, sections: [], unresolved: [], waiting: found.bundles.map(bundle => bundle.id) } });
}

// The topics a held, active protocol can answer, for suggestions. No history of what was asked is kept to build this.
export const protocolTopics = (library, today) => library.families.flatMap(family => { const now = applicable(library, family.id, today);
  return now.answerable ? now.revision.topics.filter(topic => topic.bundles.some(bundle => reviewHolds(now.revision, topic, bundle))).map(topic => ({ family, revision: now.revision, topic })) : []; });
export { ROLES };
