// A mapped answer binds one whole rule: the rule itself and every passage that must travel with it.
//
// A search returns the three paragraphs that share the most words with the question. A rule is not that. "Start at
// 12" is wrong without "only with a written order" and "never while the amber lamp is lit", and those sentences may
// share no words with the question and sit on another page. So a person writes a mapping that names every passage
// the rule depends on, each by revision digest, anchor and text hash, and a person reviews it against the original.
// Nothing here ranks, learns or votes: a mapping answers only while its review still matches it word for word.
import { passageAt } from './pdftext.js';
import { revisionOf, sealOf, bundlesOf, markMappingsReviewed as markReviewed, shortDigest } from './protocols.js';

export const MAPPING_FORMAT = 'department-hub-protocol-mapping-v1';
export const UNKNOWN = 'unknown';
// The order an answer is laid out in. Every linked passage is shown; none is dropped for length.
export const ROLES = { rule: 'The rule', condition: 'Applies when', order: 'Order required first', qualification: 'Who may do this', exception: 'Do not go ahead if', stop: 'Stop if', escalation: 'Who to call' };
export const ROLE_ORDER = Object.keys(ROLES);

const refuse = why => ({ ok: false, why });
const change = (library, id, update) => ({ ...library, revisions: library.revisions.map(revision => revision.id === id ? update(structuredClone(revision)) : revision) });
const pick = (object, names) => Object.fromEntries((names || []).filter(name => name in (object || {})).map(name => [name, object[name]]));

// Numbers with the word that follows them: "12 mk/min", "10 minutes", "24 hours". A summary may only state figures
// that the linked passages state, written the same way, so a slipped digit or a changed unit cannot be reviewed in.
export function figuresOf(text) {
  const found = [];
  for (const match of String(text || '').toLowerCase().matchAll(/(\d+(?:[.,]\d+)?)(?:\s*([a-zµ%°][a-zµ%°/]*))?/g)) found.push({ number: match[1], unit: match[2] || '', said: (match[1] + (match[2] ? ' ' + match[2] : '')) });
  return found;
}
const figureProblems = (plain, sources) => {
  const held = figuresOf(sources), problems = [];
  for (const figure of figuresOf(plain)) {
    if (held.some(source => source.number === figure.number && source.unit === figure.unit)) continue;
    const sameNumber = held.filter(source => source.number === figure.number).map(source => source.said);
    problems.push('The summary says "' + figure.said + '". The linked passages ' + (sameNumber.length ? 'say "' + [...new Set(sameNumber)].join('", "') + '".' : 'do not give that figure.'));
  }
  return problems;
};

const sealed = (revision, topic, bundle) => sealOf({ digest: revision.digest, facts: pick(revision.facts, topic.needs), topic: { ...topic, bundles: undefined }, bundle });

export function validateBundle(revision, topic, bundle) {
  const problems = [], name = '"' + (bundle.title || bundle.id || 'untitled') + '"';
  if (!bundle.id || !bundle.title) problems.push('A mapped answer needs an id and a title.');
  if (!String(bundle.plain?.interpretation || '').trim()) problems.push(name + ' has no plain-language answer.');
  const links = Array.isArray(bundle.links) ? bundle.links : [], texts = [];
  if (!links.length) problems.push(name + ' links no passage of the protocol.');
  if (!Array.isArray(bundle.requires) || !bundle.requires.length) problems.push(name + ' does not say which kinds of passage it must carry.');
  for (const link of links) {
    if (!(link.role in ROLES)) { problems.push(name + ' uses an unknown kind of link: ' + link.role + '.'); continue; }
    if (link.digest !== revision.digest) { problems.push(name + ' links ' + link.anchor + ' in file ' + shortDigest(link.digest) + ', which is not this revision (' + shortDigest(revision.digest) + ').'); continue; }
    const passage = passageAt(revision.extraction, link.anchor);
    if (!passage) { problems.push(name + ' links ' + link.anchor + ', which is not a passage in this revision.'); continue; }
    if (passage.hash !== link.hash) { problems.push(name + ' links ' + link.anchor + ', which does not read the way it did when the mapping was written.'); continue; }
    if (passage.running) problems.push(name + ' links ' + link.anchor + ', a running header or footer.');
    if (passage.figure) problems.push(name + ' links ' + link.anchor + ', a label inside a diagram. A diagram label cannot stand as a rule; link the sentence that states it.');
    if (passage.kind === 'heading') problems.push(name + ' links ' + link.anchor + ', a heading. Link the passage under it.');
    texts.push(passage.text);
  }
  for (const role of bundle.requires || []) if (!links.some(link => link.role === role)) problems.push(name + ' must carry ' + ROLES[role].toLowerCase() + ' and links none.');
  for (const [fact, value] of Object.entries(bundle.when || {})) {
    if (!(topic.needs || []).includes(fact)) problems.push(name + ' depends on "' + fact + '", which its topic does not ask about.');
    else if (!revision.facts?.[fact]?.options.some(option => option.value === value)) problems.push(name + ' depends on ' + fact + ' being "' + value + '", which is not one of its choices.');
  }
  problems.push(...figureProblems([bundle.plain?.interpretation, bundle.plain?.explanation].filter(Boolean).join(' '), texts.join(' ')).map(problem => name + ': ' + problem));
  return problems;
}

// Two answers in one topic must never both fit the same facts: there is no rule here for choosing between them.
const overlap = (a, b) => !Object.keys(a.when || {}).some(fact => fact in (b.when || {}) && a.when[fact] !== b.when[fact]);

export function validateMapping(revision, mapping) {
  if (mapping?.format !== MAPPING_FORMAT) return ['This is not a Department Hub protocol mapping file.'];
  if (mapping.revision !== revision.digest) return ['This mapping was written for file ' + shortDigest(mapping.revision) + '. This revision is file ' + shortDigest(revision.digest) +
    '. Mapped answers do not carry from one revision to another: they have to be written and reviewed against this one.'];
  const problems = [], facts = mapping.facts || {};
  for (const [name, fact] of Object.entries(facts)) {
    if (!fact.ask || !fact.name || !Array.isArray(fact.options) || fact.options.length < 2) problems.push('The question "' + name + '" needs wording, a short name and at least two choices.');
    else if (fact.options.some(option => option.value === UNKNOWN || !option.value || !option.label)) problems.push('The question "' + name + '" has a choice with no value or label, or uses the reserved value "unknown".');
    else if (new Set(fact.options.map(option => option.value)).size !== fact.options.length) problems.push('The question "' + name + '" repeats a choice.');
  }
  const ids = new Set();
  for (const topic of mapping.topics || []) {
    if (!topic.id || !topic.title || !Array.isArray(topic.bundles) || !topic.bundles.length) { problems.push('A topic needs an id, a title and at least one mapped answer.'); continue; }
    for (const need of topic.needs || []) if (!(need in facts)) problems.push('"' + topic.title + '" asks about "' + need + '", which the mapping does not define.');
    const staged = { ...revision, facts: { ...revision.facts, ...facts } };
    for (const [index, bundle] of topic.bundles.entries()) {
      if (ids.has(bundle.id)) problems.push('Two mapped answers share the id "' + bundle.id + '".');
      ids.add(bundle.id);
      problems.push(...validateBundle(staged, topic, bundle));
      for (const other of topic.bundles.slice(index + 1)) if (overlap(bundle, other)) problems.push('"' + bundle.title + '" and "' + other.title + '" could both apply to the same situation. Each must depend on a different answer to at least one question.');
    }
  }
  if (!(mapping.topics || []).length) problems.push('The mapping has no topics.');
  return problems;
}

// Takes in a mapping as proposals. Whatever the file claims, nothing in it arrives reviewed.
export function addMapping(library, id, mapping, who, at) {
  const revision = revisionOf(library, id);
  if (!revision) return refuse('That revision is not held.');
  if (revision.state === 'added') return refuse('Confirm the reading against the original first. Answers can only be mapped to text someone has checked.');
  if (revision.state === 'withdrawn') return refuse('This revision is withdrawn.');
  const problems = validateMapping(revision, mapping);
  if (problems.length) return { ok: false, why: 'The mapping was not added. ' + problems[0] + (problems.length > 1 ? ' (' + (problems.length - 1) + ' more.)' : ''), problems };
  const incoming = mapping.topics.map(topic => ({ ...topic, bundles: topic.bundles.map(({ review, ...bundle }) => bundle) })), replaced = new Set(incoming.map(topic => topic.id));
  return { ok: true, library: change(library, id, next => ({ ...next, subject: [...new Set([...(next.subject || []), ...(mapping.subject || [])])], facts: { ...next.facts, ...mapping.facts },
      topics: [...next.topics.filter(topic => !replaced.has(topic.id)), ...incoming],
      // New answers on a revision that was waiting to be made active put it back a step: they need reviewing too.
      state: next.state === 'reviewed' ? 'checked' : next.state, mappingsReviewed: next.state === 'reviewed' ? null : next.mappingsReviewed })),
    receipt: { type: 'Protocol answers mapped', details: { identifier: revision.identifier, revision: revision.label, sha256: revision.digest, topics: incoming.map(topic => topic.title),
      answers: incoming.reduce((sum, topic) => sum + topic.bundles.length, 0), note: 'Added as proposals. None answers a question until a person reviews it against the original.' } } };
}

export const reviewHolds = (revision, topic, bundle) => Boolean(bundle.review) && bundle.review.seal === sealed(revision, topic, bundle) && !validateBundle(revision, topic, bundle).length;

export function reviewBundle(library, id, bundleId, who, at) {
  const revision = revisionOf(library, id), found = bundlesOf(revision).find(({ bundle }) => bundle.id === bundleId);
  if (!revision || !found) return refuse('That mapped answer is not held.');
  if (revision.state === 'added' || revision.state === 'withdrawn') return refuse('This revision is not open for review.');
  const problems = validateBundle(revision, found.topic, found.bundle);
  if (problems.length) return { ok: false, why: 'Not marked as reviewed. ' + problems[0], problems };
  const seal = sealed(revision, found.topic, found.bundle);
  return { ok: true, library: change(library, id, next => { for (const topic of next.topics) for (const bundle of topic.bundles) if (bundle.id === bundleId) bundle.review = { by: who, at, seal }; return next; }),
    receipt: { type: 'Protocol answer reviewed', details: { identifier: revision.identifier, revision: revision.label, sha256: revision.digest, answer: found.bundle.title, seal,
      passages: found.bundle.links.map(link => link.role + ' ' + link.anchor), note: 'Recorded for the profile selected on this device. Not an authenticated clinical review.' } } };
}

export const markMappingsReviewed = (library, id, who, at) => markReviewed(library, id, who, at, reviewHolds);

// Which mapped answer fits what is known. A fact marked unknown is never taken as yes or as no: every answer it
// could lead to is returned, and the caller shows them all.
export function resolve(revision, topic, facts) {
  const given = pick(facts, topic.needs), fits = (bundle, loose) => Object.entries(bundle.when || {}).every(([fact, value]) => given[fact] === value || (loose && given[fact] === UNKNOWN));
  const sure = topic.bundles.filter(bundle => fits(bundle, false));
  if (sure.length > 1) return { kind: 'conflict', bundles: sure };
  if (sure.length === 1) return reviewHolds(revision, topic, sure[0]) ? { kind: 'answer', bundle: sure[0] } : { kind: 'unreviewed', bundles: sure };
  const possible = topic.bundles.filter(bundle => fits(bundle, true));
  if (!possible.length) return { kind: 'uncovered', bundles: [] };
  // Showing only the reviewed half of the possibilities would hide the other half. All of them, or none.
  if (possible.some(bundle => !reviewHolds(revision, topic, bundle))) return { kind: 'unreviewed', bundles: possible.filter(bundle => !reviewHolds(revision, topic, bundle)) };
  return { kind: 'unresolved', bundles: possible, unknown: (topic.needs || []).filter(fact => given[fact] === UNKNOWN && possible.some(bundle => fact in (bundle.when || {}))) };
}

// Every passage the answer depends on, in a fixed order, read from the revision as it is held now.
export function wholeRule(revision, bundle) {
  return ROLE_ORDER.map(role => ({ role, heading: ROLES[role], passages: bundle.links.filter(link => link.role === role).map(link => {
    const passage = passageAt(revision.extraction, link.anchor);
    return { role, anchor: link.anchor, digest: link.digest, page: passage.page, text: passage.text, context: passage.context, supplied: passage.supplied };
  }) })).filter(section => section.passages.length);
}
