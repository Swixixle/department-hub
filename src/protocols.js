// The protocol library: a family (one protocol, known by its identifier) and its revisions (each one exact file).
//
// A revision is never edited. What changes is how far it has been checked, recorded as a state:
//   added      the file is held and its text was read; nobody has compared the reading with the original
//   checked    a person compared the reading with the original and confirmed it
//   reviewed   a person reviewed every answer mapped to this revision
//   active     a person made it the revision in use from its effective date
//   withdrawn  a person withdrew it, with a reason
// Whether a revision is the one in force is worked out from dates, not stored: a later revision whose effective
// date has arrived supersedes an earlier one from that day, whatever state the later one has reached. Until the
// later one is active and its answers reviewed, the protocol has no ordinary answer. It never falls back.
//
// "A person" means the profile selected on this device. Nothing here verifies who that is, and a recorded review is
// not clinical sign-off. A content digest says which file this is; it does not say anyone approved it.
import { keywords, stem } from './words.js';
import { passagesIn, suppliedBlocks } from './pdftext.js';

export const STATES = ['added', 'checked', 'reviewed', 'active', 'withdrawn'];
export const STANDING = {
  added: 'Added · reading not checked', checked: 'Reading checked · answers not reviewed', reviewed: 'Answers reviewed · not yet active',
  scheduled: 'Active from its effective date', active: 'Active', superseded: 'Superseded · history only', withdrawn: 'Withdrawn' };

export const emptyLibrary = () => ({ families: [], revisions: [], marks: [] });
// A workspace saved before protocols existed has no library. Anything already held is kept exactly as it was.
export const prepareLibrary = held => ({ families: Array.isArray(held?.families) ? held.families : [], revisions: Array.isArray(held?.revisions) ? held.revisions : [],
  marks: Array.isArray(held?.marks) ? held.marks : [] });

const refuse = why => ({ ok: false, why });
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value + 'T12:00:00Z'));
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const key = identifier => clean(identifier).toUpperCase();
const change = (library, id, update) => ({ ...library, revisions: library.revisions.map(revision => revision.id === id ? update(structuredClone(revision)) : revision) });
export const revisionOf = (library, id) => library.revisions.find(revision => revision.id === id) || null;
export const familyOf = (library, id) => library.families.find(family => family.id === id) || null;
export const historyOf = (library, familyId) => library.revisions.filter(revision => revision.family === familyId)
  .sort((a, b) => b.effective.localeCompare(a.effective) || b.added.at.localeCompare(a.added.at));
export const shortDigest = digest => String(digest || '').slice(0, 12);

export function addRevision(library, input, who, at) {
  const fields = { title: clean(input.title), identifier: clean(input.identifier), authority: clean(input.authority), label: clean(input.label), category: clean(input.category) || 'Protocol',
    location: clean(input.location), effective: input.effective };
  for (const [name, said] of [['title', 'a title'], ['identifier', 'the protocol identifier'], ['authority', 'who issued it'], ['label', 'the revision']]) if (!fields[name]) return refuse('Give ' + said + ', as printed on the document.');
  if (!isDate(fields.effective)) return refuse('Give the effective date printed on the document.');
  if (!/^[a-f0-9]{64}$/.test(input.digest || '')) return refuse('The file could not be fingerprinted, so it was not added.');
  if (input.extraction?.unreadable) return refuse(input.extraction.unreadable);
  if (!input.extraction?.pages?.length) return refuse('No pages could be read from this file, so it was not added.');
  const held = library.revisions.find(revision => revision.digest === input.digest);
  if (held) return refuse('This exact file is already held as ' + held.title + ', revision ' + held.label + '.');
  let family = library.families.find(candidate => key(candidate.identifier) === key(fields.identifier));
  if (family && library.revisions.some(revision => revision.family === family.id && clean(revision.label).toLowerCase() === fields.label.toLowerCase() && revision.state !== 'withdrawn'))
    return refuse('Revision ' + fields.label + ' of ' + family.identifier + ' is already held with different contents. Withdraw it first if this file replaces it.');
  const families = family ? library.families : [...library.families, family = { id: 'pf-' + key(fields.identifier).replace(/[^A-Z0-9]+/g, '-').toLowerCase(), identifier: fields.identifier }];
  const revision = { id: 'pr-' + input.digest.slice(0, 16), family: family.id, ...fields, digest: input.digest, file: { name: clean(input.file?.name), bytes: Number(input.file?.bytes) || 0 },
    added: { by: who, at }, state: 'added', extraction: input.extraction, checked: null, facts: {}, topics: [], mappingsReviewed: null, activated: null, withdrawn: null };
  const earlier = historyOf(library, family.id).filter(other => other.state !== 'withdrawn');
  return { ok: true, library: { ...library, families, revisions: [...library.revisions, revision] }, revision, family,
    receipt: { type: 'Protocol revision added', details: { identifier: family.identifier, revision: fields.label, effective: fields.effective, authority: fields.authority, file: revision.file.name, bytes: revision.file.bytes,
      sha256: input.digest, pages: input.extraction.pages.length, pagesWithNoText: input.extraction.emptyPages || [], reader: input.extraction.reader, alongside: earlier.map(other => other.label + ' (' + shortDigest(other.digest) + ')') } } };
}

const unchecked = (library, id, action) => {
  const revision = revisionOf(library, id);
  if (!revision) return refuse('That revision is not held.');
  if (revision.state !== 'added') return refuse('The reading of this revision was already confirmed. ' + action + ' would change what was confirmed, so add the file again as a new import instead.');
  return null;
};

// Verified text for a page the reader returned nothing for. It is the reviewer's transcription, and is labelled so.
export async function supplyText(library, id, page, text, who, at) {
  const stopped = unchecked(library, id, 'Typing in text');
  if (stopped) return stopped;
  const revision = revisionOf(library, id), target = revision.extraction.pages.find(candidate => candidate.number === page);
  if (!target) return refuse('That page is not in this file.');
  if (target.blocks.some(block => !block.supplied)) return refuse('Page ' + page + ' has text the reader found. Typed-in text is only for a page that read as empty.');
  const blocks = await suppliedBlocks(page, text);
  if (!blocks.length) return refuse('Type the text of page ' + page + ' exactly as the original shows it.');
  return { ok: true, library: change(library, id, next => { const held = next.extraction.pages.find(candidate => candidate.number === page); held.blocks = blocks; held.supplied = { by: who, at }; return next; }),
    receipt: { type: 'Protocol page text supplied', details: { sha256: revision.digest, page, passages: blocks.length, note: 'Typed in by a person because the reader found no text on this page.' } } };
}

// Marks a passage as a label inside a drawing, or clears the mark. A figure label can be pointed to, never quoted as a rule.
export function markFigure(library, id, anchor, on) {
  const stopped = unchecked(library, id, 'Changing what counts as diagram text');
  if (stopped) return stopped;
  const found = revisionOf(library, id).extraction.pages.some(page => page.blocks.some(block => block.anchor === anchor && block.kind === 'text'));
  if (!found) return refuse('That passage is not in this revision.');
  return { ok: true, library: change(library, id, next => { for (const page of next.extraction.pages) for (const block of page.blocks) if (block.anchor === anchor) { if (on) block.figure = true; else delete block.figure; } return next; }) };
}

export function checkExtraction(library, id, who, at) {
  const revision = revisionOf(library, id);
  if (!revision) return refuse('That revision is not held.');
  if (revision.state !== 'added') return refuse('The reading of this revision was already confirmed.');
  const empty = revision.extraction.pages.filter(page => !page.blocks.length).map(page => page.number);
  if (empty.length) return refuse('Page' + (empty.length === 1 ? ' ' : 's ') + empty.join(', ') + ' read as empty. A scanned page is not read here. Type in its text from the original, or withdraw this import. It cannot be confirmed as it is.');
  return { ok: true, library: change(library, id, next => ({ ...next, state: 'checked', checked: { by: who, at } })),
    receipt: { type: 'Protocol reading confirmed', details: { identifier: revision.identifier, revision: revision.label, sha256: revision.digest, pages: revision.extraction.pages.length,
      typedInPages: revision.extraction.pages.filter(page => page.supplied).map(page => page.number), diagramLabels: revision.extraction.pages.reduce((sum, page) => sum + page.blocks.filter(block => block.figure).length, 0),
      note: 'Recorded for the profile selected on this device. Not an authenticated clinical review.' } } };
}

// A review is bound to the exact mapping reviewed. Change one word of it and the review no longer applies.
export function sealOf(value) {
  const text = JSON.stringify(value, (name, held) => name === 'review' ? undefined : held && typeof held === 'object' && !Array.isArray(held) ? Object.fromEntries(Object.keys(held).sort().map(field => [field, held[field]])) : held);
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) { const code = text.charCodeAt(index); a = Math.imul(a ^ code, 2654435761); b = Math.imul(b ^ code, 1597334677); }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909); b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (b >>> 0).toString(16).padStart(8, '0') + (a >>> 0).toString(16).padStart(8, '0') + ':' + text.length;
}
export const bundlesOf = revision => (revision?.topics || []).flatMap(topic => topic.bundles.map(bundle => ({ topic, bundle })));
// Whether the mapping as it stands now is the one a person reviewed. Overridden with the full check in bundles.js.
export const reviewHolds = (revision, topic, bundle) => Boolean(bundle.review) && bundle.review.seal === sealOf({ digest: revision.digest, facts: revision.facts, topic: { ...topic, bundles: undefined }, bundle });

export function markMappingsReviewed(library, id, who, at, holds = reviewHolds) {
  const revision = revisionOf(library, id);
  if (!revision) return refuse('That revision is not held.');
  if (revision.state !== 'checked') return refuse(revision.state === 'added' ? 'Confirm the reading against the original first.' : 'This revision is already past that step.');
  const open = bundlesOf(revision).filter(({ topic, bundle }) => !holds(revision, topic, bundle));
  if (open.length) return refuse(open.length + ' mapped answer' + (open.length === 1 ? ' has' : 's have') + ' not been reviewed: ' + open.map(({ bundle }) => bundle.title).join('; ') + '.');
  return { ok: true, library: change(library, id, next => ({ ...next, state: 'reviewed', mappingsReviewed: { by: who, at } })),
    receipt: { type: 'Protocol answers reviewed', details: { identifier: revision.identifier, revision: revision.label, sha256: revision.digest, answers: bundlesOf(revision).length,
      note: bundlesOf(revision).length ? 'Every mapped answer was reviewed one at a time before this.' : 'No answers are mapped. The revision can be read and searched; Ask will quote passages, not answer.' } } };
}

export function activate(library, id, who, at, today) {
  const revision = revisionOf(library, id);
  if (!revision) return refuse('That revision is not held.');
  if (revision.state !== 'reviewed') return refuse(revision.state === 'active' ? 'This revision is already active.' : revision.state === 'withdrawn' ? 'A withdrawn revision cannot be made active. Add the file again.'
    : 'Confirm the reading and review the mapped answers first.');
  const twin = library.revisions.find(other => other.family === revision.family && other.id !== id && other.state !== 'withdrawn' && other.effective === revision.effective);
  if (twin) return refuse('Revision ' + twin.label + ' is also dated ' + revision.effective + '. Two revisions cannot take effect on the same day. Withdraw the one that is wrong.');
  const replaced = library.revisions.filter(other => other.family === revision.family && other.id !== id && other.state !== 'withdrawn' && other.effective < revision.effective);
  return { ok: true, library: change(library, id, next => ({ ...next, state: 'active', activated: { by: who, at } })),
    receipt: { type: 'Protocol revision made active', details: { identifier: revision.identifier, revision: revision.label, sha256: revision.digest, effective: revision.effective,
      inForce: revision.effective <= today ? 'from now' : 'from ' + revision.effective, replaces: replaced.map(other => other.label + ' (' + shortDigest(other.digest) + ')'),
      note: 'Earlier revisions stay in the history. Their mapped answers do not carry over.' } } };
}

export function withdraw(library, id, reason, who, at) {
  const revision = revisionOf(library, id);
  if (!revision) return refuse('That revision is not held.');
  if (revision.state === 'withdrawn') return refuse('This revision is already withdrawn.');
  if (!clean(reason)) return refuse('Say why it is being withdrawn. The reason is kept with the record.');
  return { ok: true, library: change(library, id, next => ({ ...next, state: 'withdrawn', withdrawn: { by: who, at, reason: clean(reason), from: revision.state } })),
    receipt: { type: 'Protocol revision withdrawn', details: { identifier: revision.identifier, revision: revision.label, sha256: revision.digest, was: revision.state, reason: clean(reason) } } };
}

// Where a revision stands today. "superseded" and "scheduled" come from dates, so they need no one to remember to set them.
export function standing(library, revision, today) {
  if (revision.state === 'withdrawn') return 'withdrawn';
  const later = library.revisions.some(other => other.family === revision.family && other.id !== revision.id && other.state !== 'withdrawn' && other.effective > revision.effective && other.effective <= today);
  if (later && revision.effective <= today) return 'superseded';
  if (revision.state === 'active' && revision.effective > today) return 'scheduled';
  return revision.state;
}

// The one revision that speaks for a protocol today, or the reason there is none. It never picks between two
// revisions dated the same day, and never reaches back to an earlier revision because the current one is unfinished.
export function applicable(library, familyId, today) {
  const family = familyOf(library, familyId), live = historyOf(library, familyId).filter(revision => revision.state !== 'withdrawn');
  const inForce = live.filter(revision => revision.effective <= today), upcoming = live.filter(revision => revision.effective > today).at(-1) || null;
  const base = { family, upcoming, conflict: null, revision: null, answerable: false };
  if (!live.length) return { ...base, status: 'none', why: historyOf(library, familyId).length ? 'Every revision held of ' + family.identifier + ' has been withdrawn.' : 'No revision of this protocol is held.' };
  if (!inForce.length) return { ...base, status: 'not-yet', why: 'No revision of ' + family.identifier + ' is in effect yet. Revision ' + upcoming.label + ' takes effect on ' + upcoming.effective + '.' };
  const top = inForce.filter(revision => revision.effective === inForce[0].effective);
  if (top.length > 1) return { ...base, status: 'conflict', conflict: top, why: 'Revisions ' + top.map(revision => revision.label).join(' and ') + ' of ' + family.identifier + ' both take effect on ' + top[0].effective +
    '. Department Hub does not choose between them. Whoever issued them has to say which stands; then withdraw the other.' };
  const revision = top[0], answerable = revision.state === 'active';
  return { ...base, revision, answerable, status: answerable ? 'active' : 'pending',
    why: answerable ? '' : 'Revision ' + revision.label + ' of ' + family.identifier + ' has been in effect since ' + revision.effective + ', and its review here is not finished (' + STANDING[revision.state].toLowerCase() +
      '). Earlier revisions are history and are not used to answer.' };
}

export const toggleMark = (library, familyId) => ({ ...library, marks: library.marks.includes(familyId) ? library.marks.filter(id => id !== familyId) : [...library.marks, familyId] });

// Looking through what is held. It runs on this device and keeps nothing: no query, no result, no name.
export function searchLibrary(library, query, today, { history = false } = {}) {
  const wanted = [...new Set(keywords(query).map(stem))];
  if (!wanted.length) return [];
  const found = [];
  for (const family of library.families) {
    const current = applicable(library, family.id, today), revisions = history ? historyOf(library, family.id) : [current.revision, ...(current.conflict || [])].filter(Boolean);
    for (const revision of revisions) {
      const meta = new Set(keywords(revision.title + ' ' + revision.identifier).map(stem));
      for (const passage of passagesIn(revision.extraction)) {
        if (passage.running || passage.figure) continue;
        const words = new Set(keywords(passage.text + ' ' + (passage.under || '')).map(stem)), hits = wanted.filter(term => words.has(term));
        if (hits.length) found.push({ family, revision, passage, standing: standing(library, revision, today), score: hits.length / wanted.length + wanted.filter(term => meta.has(term)).length * 0.1 + (passage.kind === 'heading' ? -0.05 : 0) });
      }
    }
  }
  return found.sort((a, b) => b.score - a.score || a.revision.effective.localeCompare(b.revision.effective) * -1).slice(0, 12);
}
