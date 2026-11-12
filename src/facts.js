// Reference knowledge: short cards stating a fact, each citing the page it was read from.
//
// This is general reference knowledge (a normal range, a definition), not a hospital's protocol. A card is written
// in the app's own words with the source's figures, names its source and the place in it, and links to the page.
// The source's text is not held, so nothing here can check a card against it. A person does that: they open the
// cited page and confirm the card matches, and until then the card answers nothing. That check is custody of a
// figure, not a clinical judgement. The source is the authority; the person is vouching only that the card copies it.
import { stem, nearest, CORE_WORDS } from './words.js';
import { sealOf } from './protocols.js';

export const CARD_FORMAT = 'department-hub-fact-cards-v1';
export const NOT_A_PROTOCOL = 'Reference knowledge. It is not your hospital’s protocol and not an order for any patient.';
export const CUSTODY = 'Recorded for the profile selected on this device as a check that the card matches the cited page. It is not clinical sign-off.';

const refuse = why => ({ ok: false, why });
const COMMON = new Set(CORE_WORDS);
const words = text => String(text || '').toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9'/]+/g, ' ').trim().split(' ').filter(Boolean);
const stems = text => words(text).map(word => stem(word.replace(/'/g, '')));
const has = (sequence, phrase) => { const wanted = stems(phrase); return wanted.length > 0 && sequence.some((_, at) => wanted.every((word, offset) => sequence[at + offset] === word)); };
const setsOf = library => Array.isArray(library?.knowledge) ? library.knowledge : [];
const sealed = (set, card) => sealOf({ source: set.source, applies: set.applies, card });
export const cardHolds = (set, card) => Boolean(card.review) && card.review.seal === sealed(set, card);
export const cite = set => set.source.title + ' · ' + set.source.publisher + (set.source.year ? ', ' + set.source.year : '') + ' · ' + set.source.licence;

export function validateSet(set) {
  if (set?.format !== CARD_FORMAT) return ['This is not a Department Hub reference card file.'];
  const problems = [], source = set.source || {};
  if (!set.id || !set.title) problems.push('The set needs an id and a title.');
  if (!source.title || !source.publisher || !source.licence || !/^\d{4}-\d{2}-\d{2}$/.test(source.readOn || '')) problems.push('The source needs a title, a publisher, a licence and the date it was read.');
  if (!/^https:\/\/[a-z0-9.-]+\//i.test(source.url || '')) problems.push('The source needs a secure web address a person can open.');
  if (!Array.isArray(set.cards) || !set.cards.length) problems.push('The set has no cards.');
  const ids = new Set();
  for (const card of set.cards || []) {
    if (!card.id || ids.has(card.id)) problems.push('Every card needs its own id.');
    ids.add(card.id);
    if (!card.title || !String(card.answer || '').trim()) problems.push('Card "' + (card.title || card.id) + '" needs a title and an answer.');
    if (!card.where) problems.push('Card "' + (card.title || card.id) + '" does not say where in the source its figures are.');
    if (!Array.isArray(card.said) || !card.said.length) problems.push('Card "' + (card.title || card.id) + '" lists no wording to recognise it by.');
    if (!['once', 'twice'].includes(card.read)) problems.push('Card "' + (card.title || card.id) + '" does not say how many times its figures were read from the source.');
  }
  return problems;
}

// Takes in a set as unchecked cards. Whatever the file claims, no card arrives checked.
export function addSet(library, set, who, at) {
  const problems = validateSet(set);
  if (problems.length) return { ok: false, why: 'The cards were not added. ' + problems[0], problems };
  if (setsOf(library).some(held => held.id === set.id && !held.withdrawn)) return refuse('These reference cards are already held.');
  const taken = { ...set, cards: set.cards.map(({ review, ...card }) => card), added: { by: who, at }, withdrawn: null };
  return { ok: true, library: { ...library, knowledge: [...setsOf(library).filter(held => held.id !== set.id), taken] }, set: taken,
    receipt: { type: 'Reference cards added', details: { set: set.id, title: set.title, cards: set.cards.length, source: set.source.url, licence: set.source.licence, readOn: set.source.readOn,
      note: 'Added unchecked. No card answers a question until a person has compared it with the cited page.' } } };
}

export function reviewCard(library, setId, cardId, who, at) {
  const set = setsOf(library).find(held => held.id === setId), card = set?.cards.find(entry => entry.id === cardId);
  if (!set || !card) return refuse('That reference card is not held.');
  if (set.withdrawn) return refuse('These cards have been withdrawn.');
  const seal = sealed(set, card);
  return { ok: true, library: { ...library, knowledge: setsOf(library).map(held => held.id !== setId ? held : { ...held, cards: held.cards.map(entry => entry.id !== cardId ? entry : { ...entry, review: { by: who, at, seal } }) }) },
    receipt: { type: 'Reference card checked', details: { set: setId, card: card.title, where: card.where, source: set.source.url, readOn: set.source.readOn, seal, note: CUSTODY } } };
}

export function withdrawSet(library, setId, reason, who, at) {
  const set = setsOf(library).find(held => held.id === setId);
  if (!set || set.withdrawn) return refuse('Those reference cards are not held.');
  if (!String(reason || '').trim()) return refuse('Say why the cards are being withdrawn. The reason is kept with the record.');
  return { ok: true, library: { ...library, knowledge: setsOf(library).map(held => held.id !== setId ? held : { ...held, withdrawn: { by: who, at, reason: String(reason).trim() } }) },
    receipt: { type: 'Reference cards withdrawn', details: { set: setId, title: set.title, reason: String(reason).trim() } } };
}

// A question is taken only when it uses a card's own wording. Near-miss spelling of that wording is read as it.
export function factAnswer(question, world) {
  const live = setsOf(world.protocols).filter(set => !set.withdrawn);
  if (!live.length || !String(question || '').trim()) return null;
  const known = new Set(live.flatMap(set => set.cards.flatMap(card => card.said.flatMap(words))).filter(word => word.length >= 5)), knownStems = new Set([...known].map(stem)), changes = [];
  const read = words(question).map(word => {
    if (word.length < 5 || /\d/.test(word) || known.has(word) || knownStems.has(stem(word)) || COMMON.has(word)) return word;
    const fixed = nearest(word, known);
    if (fixed && fixed !== word) { changes.push([word, fixed]); return fixed; }
    return word;
  }).join(' '), sequence = stems(read);
  const matched = live.flatMap(set => set.cards.map(card => { const phrases = card.said.filter(phrase => has(sequence, phrase)).map(stems); return { set, card, phrases, score: Math.max(0, ...phrases.map(phrase => phrase.length)) }; }))
    .filter(hit => hit.score > 0).sort((a, b) => b.score - a.score);
  if (!matched.length) return null;
  // "Respiratory acidosis" is one subject, not that card plus the general acidosis card. A card whose only matching
  // words sit inside a better match is left out; "normal pH and PaCO2" keeps both, because neither contains the other.
  const inside = (small, big) => big.some((_, at) => small.every((word, offset) => big[at + offset] === word));
  const best = matched.filter((hit, index) => !matched.slice(0, index).some(better => better.score > hit.score && hit.phrases.every(phrase => better.phrases.some(other => inside(phrase, other))))).slice(0, 4);
  const base = { kind: 'fact', empty: false, read: changes.length ? read : '', changes, next: [], context: { kind: 'fact' } };
  const checked = best.filter(hit => cardHolds(hit.set, hit.card)), waiting = best.filter(hit => !cardHolds(hit.set, hit.card));
  // A card nobody has compared with its source says nothing. Its figures are not shown.
  if (!checked.length) return { ...base, title: 'A reference card on this is held and has not been checked against its source', understood: 'reference knowledge: ' + waiting[0].card.title.toLowerCase(),
    lines: ['Until a person has compared it with the cited page it gives no answer.'], items: [{ text: waiting[0].set.title, sub: 'Open the cards to check them', go: 'knowledge|' + waiting[0].set.id }],
    source: cite(waiting[0].set), fact: { status: 'unchecked', cards: waiting.map(hit => hit.card.id) } };
  const first = checked[0], related = first.set.cards.filter(card => cardHolds(first.set, card) && !checked.some(hit => hit.card.id === card.id)).map(card => card.title);
  return { ...base, title: checked.length === 1 ? first.card.answer : 'Reference cards on this:', understood: 'reference knowledge: ' + checked.map(hit => hit.card.title.toLowerCase()).join('; '),
    lines: [...(checked.length > 1 ? checked.map(hit => hit.card.answer) : []), NOT_A_PROTOCOL + ' ' + first.set.applies,
      ...(waiting.length ? [waiting.length + ' more card' + (waiting.length === 1 ? '' : 's') + ' on this ' + (waiting.length === 1 ? 'is' : 'are') + ' held and not yet checked, so ' + (waiting.length === 1 ? 'it is' : 'they are') + ' not shown.'] : [])],
    items: checked.map(({ set, card }) => ({ text: set.source.title + ' · ' + card.where, href: set.source.url, card: card.id,
      sub: [set.source.publisher + (set.source.year ? ', ' + set.source.year : ''), set.source.licence, 'read from the page on ' + set.source.readOn + (card.read === 'twice' ? '; two separate readings agreed' : '; read once'),
        'the page’s own text is not held here, so open it to see the figures in place'].join(' · ') })),
    next: related.slice(0, 4), source: 'A reference card citing ' + cite(first.set) + '. Checked against that page by ' + first.card.review.by + ' on ' + first.card.review.at.slice(0, 10) +
      ', under the profile selected on this device. That is a check that the card matches the page, not clinical sign-off.',
    fact: { status: 'answer', cards: checked.map(hit => hit.card.id), set: first.set.id, waiting: waiting.map(hit => hit.card.id) } };
}
