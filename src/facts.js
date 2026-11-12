// Reference knowledge: short cards stating a fact, each resting on passages of a page held here exactly as captured.
//
// This is general reference knowledge (a normal range, a definition), not a hospital's protocol. The page is held as
// a Blinders capture: the rendered text of the page, byte for byte, with the SHA-256 Blinders recorded when it saved
// it. Cards are refused unless the held text hashes to that receipt, every passage a card cites is in it, and every
// number a card states appears in its passages. That is a mechanical check of custody and figures. What it cannot
// check is that a card's sentence says what its passage says, so a person still records that, comparing the card with
// the passage shown under it. Until then the card answers nothing. That check is custody, not a clinical judgement.
import { stem, nearest, CORE_WORDS } from './words.js';
import { sealOf } from './protocols.js';
import { sha256 } from './audit.js';

export const CARD_FORMAT = 'department-hub-fact-cards-v2';
export const OLD_FORMAT = 'department-hub-fact-cards-v1';
export const NOT_A_PROTOCOL = 'Reference knowledge. It is not your hospital’s protocol and not an order for any patient.';
export const CUSTODY = 'Recorded for the profile selected on this device as a check that the card says what the captured passage says. It is not clinical sign-off.';

const refuse = why => ({ ok: false, why });
const COMMON = new Set(CORE_WORDS);
const words = text => String(text || '').toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9'/]+/g, ' ').trim().split(' ').filter(Boolean);
const stems = text => words(text).map(word => stem(word.replace(/'/g, '')));
const has = (sequence, phrase) => { const wanted = stems(phrase); return wanted.length > 0 && sequence.some((_, at) => wanted.every((word, offset) => sequence[at + offset] === word)); };
const setsOf = library => Array.isArray(library?.knowledge) ? library.knowledge : [];
// Only cards built on a held capture answer. A set from the earlier format rested on an AI reading of the page.
const current = set => set?.format === CARD_FORMAT && typeof set.held?.text === 'string';
// The seal covers the card, its source and receipt, and the very passages it was checked against.
const sealed = (set, card) => sealOf({ source: set.source, applies: set.applies, card, passages: card.passages.map(range => passageText(set.held.text, range)) });
export const cardHolds = (set, card) => current(set) && Boolean(card.review) && card.review.seal === sealed(set, card);
export const cite = set => set.source.title + ' · ' + set.source.publisher + (set.source.year ? ', ' + set.source.year : '') + ' · ' + set.source.licence;
export const shortDigest = digest => String(digest || '').slice(0, 8) + '…' + String(digest || '').slice(-6);

// A passage is a run of the capture's lines, first to last inclusive, with the blank lines between them left out.
export const passageText = (text, [from, to]) => String(text).split('\n').slice(from, to + 1).filter(line => line.trim()).join('\n');
export const passagesOf = (set, card) => card.passages.map(range => passageText(set.held.text, range));
// Numbers standing on their own: "7.35", "100", "2016". The 2 in PaO2 and the 3 in HCO3 are part of a name, not a figure.
export const numbersOf = text => [...String(text).matchAll(/(?<![A-Za-z0-9.])\d+(?:\.\d+)?/g)].map(match => match[0]);

export function validateSet(set, held) {
  if (set?.format === OLD_FORMAT) return ['These cards are in the earlier format, which rested on an AI reading of the page. Add the cards built on a captured copy instead.'];
  if (set?.format !== CARD_FORMAT) return ['This is not a Department Hub reference card file.'];
  const problems = [], source = set.source || {}, capture = source.capture || {};
  if (!set.id || !set.title) problems.push('The set needs an id and a title.');
  if (!source.title || !source.publisher || !source.licence || !/^\d{4}-\d{2}-\d{2}$/.test(source.readOn || '')) problems.push('The source needs a title, a publisher, a licence and the date it was read.');
  if (!/^https:\/\/[a-z0-9.-]+\//i.test(source.url || '')) problems.push('The source needs a secure web address a person can open.');
  if (!/^[0-9a-f]{64}$/.test(capture.sha256 || '') || !Number.isInteger(capture.bytes) || !capture.id) problems.push('The source needs the receipt of the capture it rests on: its id, byte count and SHA-256.');
  if (!Array.isArray(set.cards) || !set.cards.length) problems.push('The set has no cards.');
  const text = typeof held?.text === 'string' ? held.text : null, lines = text === null ? 0 : text.split('\n').length;
  if (text === null) problems.push('The captured page is not held, so no card can be checked against it.');
  const ids = new Set();
  for (const card of set.cards || []) {
    const name = '"' + (card.title || card.id) + '"';
    if (!card.id || ids.has(card.id)) problems.push('Every card needs its own id.');
    ids.add(card.id);
    if (!card.title || !String(card.answer || '').trim()) problems.push('Card ' + name + ' needs a title and an answer.');
    if (!card.where) problems.push('Card ' + name + ' does not say where in the source it comes from.');
    if (!Array.isArray(card.said) || !card.said.length) problems.push('Card ' + name + ' lists no wording to recognise it by.');
    const ranges = Array.isArray(card.passages) ? card.passages : [];
    if (!ranges.length || ranges.some(range => !Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger) || range[0] < 0 || range[1] < range[0] || range[1] >= lines)) {
      if (text !== null) problems.push('Card ' + name + ' cites a passage that is not in the captured page.');
      continue;
    }
    if (text === null) continue;
    const quoted = ranges.map(range => passageText(text, range));
    if (quoted.some(passage => !passage)) { problems.push('Card ' + name + ' cites a passage of blank lines.'); continue; }
    const present = new Set(quoted.flatMap(numbersOf)), missing = numbersOf(card.answer).filter(figure => !present.has(figure));
    if (missing.length) problems.push('Card ' + name + ' states ' + missing.join(', ') + ', which its passages do not contain.');
  }
  return problems;
}

// The held text must be the bytes Blinders saved. Checked by hashing, before anything else.
export async function verifyCapture(set, held) {
  const problems = [];
  for (const [what, receipt, text] of [['page', set?.source?.capture, held?.text], ['licence line', set?.source?.licenceCapture, held?.licence]]) {
    if (!receipt) { if (what === 'page') problems.push('The cards name no capture.'); continue; }
    if (typeof text !== 'string') { problems.push('The captured ' + what + ' is not held.'); continue; }
    const bytes = new TextEncoder().encode(text).length, digest = await sha256(text);
    if (digest !== receipt.sha256 || bytes !== receipt.bytes) problems.push('The held ' + what + ' is not the one captured: its SHA-256 is ' + shortDigest(digest) + ' (' + bytes + ' bytes), the receipt says ' + shortDigest(receipt.sha256) + ' (' + receipt.bytes + ' bytes).');
  }
  return problems;
}

// Takes in a set as unchecked cards, with the page it rests on. Whatever the file claims, no card arrives checked.
// Cards it replaces, held from the earlier format, are withdrawn with the reason recorded.
export async function addSet(library, set, held, who, at) {
  const problems = [...await verifyCapture(set, held), ...validateSet(set, held)];
  if (problems.length) return { ok: false, why: 'The cards were not added. ' + problems[0], problems };
  if (setsOf(library).some(other => other.id === set.id && !other.withdrawn)) return refuse('These reference cards are already held.');
  const replaced = setsOf(library).filter(other => !other.withdrawn && (set.replaces || []).includes(other.id));
  const reason = 'Replaced by cards resting on a captured copy of the page (' + set.source.capture.tool + ' capture ' + set.source.capture.id + ').';
  const taken = { ...set, cards: set.cards.map(({ review, ...card }) => card), held: { text: held.text, licence: held.licence ?? null }, added: { by: who, at }, withdrawn: null };
  const kept = setsOf(library).filter(other => other.id !== set.id).map(other => replaced.includes(other) ? { ...other, withdrawn: { by: who, at, reason } } : other);
  return { ok: true, library: { ...library, knowledge: [...kept, taken] }, set: taken, replaced: replaced.map(other => other.id),
    receipt: { type: 'Reference cards added', details: { set: set.id, title: set.title, cards: set.cards.length, source: set.source.url, licence: set.source.licence,
      capture: set.source.capture.id, sha256: set.source.capture.sha256, bytes: set.source.capture.bytes, captured: set.source.capture.savedAt, replaced: replaced.map(other => other.id),
      note: 'The held page matched its capture receipt and every figure was found in its cited passages. Added unchecked: no card answers until a person has compared it with its passages.' } } };
}

export function reviewCard(library, setId, cardId, who, at) {
  const set = setsOf(library).find(held => held.id === setId), card = set?.cards.find(entry => entry.id === cardId);
  if (!set || !card) return refuse('That reference card is not held.');
  if (set.withdrawn) return refuse('These cards have been withdrawn.');
  if (!current(set)) return refuse('These cards rest on an AI reading of the page, not a captured copy. Add the captured cards instead.');
  const seal = sealed(set, card);
  return { ok: true, library: { ...library, knowledge: setsOf(library).map(held => held.id !== setId ? held : { ...held, cards: held.cards.map(entry => entry.id !== cardId ? entry : { ...entry, review: { by: who, at, seal } }) }) },
    receipt: { type: 'Reference card checked', details: { set: setId, card: card.title, where: card.where, source: set.source.url, capture: set.source.capture.id, sha256: set.source.capture.sha256, seal, note: CUSTODY } } };
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
  const live = setsOf(world.protocols).filter(set => !set.withdrawn && current(set));
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
  // A card nobody has compared with its passages says nothing. Neither its figures nor the passages are shown.
  if (!checked.length) return { ...base, title: 'A reference card on this is held and has not been checked against its source', understood: 'reference knowledge: ' + waiting[0].card.title.toLowerCase(),
    lines: ['Until a person has compared it with the passage it rests on, it gives no answer.'], items: [{ text: waiting[0].set.title, sub: 'Open the cards to check them', go: 'knowledge|' + waiting[0].set.id }],
    source: cite(waiting[0].set), fact: { status: 'unchecked', cards: waiting.map(hit => hit.card.id) } };
  const first = checked[0], capture = first.set.source.capture, related = first.set.cards.filter(card => cardHolds(first.set, card) && !checked.some(hit => hit.card.id === card.id)).map(card => card.title);
  return { ...base, title: checked.length === 1 ? first.card.answer : 'Reference cards on this:', understood: 'reference knowledge: ' + checked.map(hit => hit.card.title.toLowerCase()).join('; '),
    lines: [...(checked.length > 1 ? checked.map(hit => hit.card.answer) : []), NOT_A_PROTOCOL + ' ' + first.set.applies,
      ...(waiting.length ? [waiting.length + ' more card' + (waiting.length === 1 ? '' : 's') + ' on this ' + (waiting.length === 1 ? 'is' : 'are') + ' held and not yet checked, so ' + (waiting.length === 1 ? 'it is' : 'they are') + ' not shown.'] : [])],
    items: checked.map(({ set, card }) => ({ text: 'The source’s own words · ' + card.where, quote: passagesOf(set, card), href: set.source.url, card: card.id,
      sub: [set.source.publisher + (set.source.year ? ', ' + set.source.year : ''), set.source.licence,
        'exact text captured with ' + set.source.capture.tool + ' on ' + set.source.capture.savedAt.slice(0, 10) + ', SHA-256 ' + shortDigest(set.source.capture.sha256)].join(' · ') })),
    next: related.slice(0, 4), source: 'A reference card resting on ' + cite(first.set) + ', held as ' + capture.tool + ' capture ' + capture.id + '. The card was checked against those passages by ' + first.card.review.by + ' on ' +
      first.card.review.at.slice(0, 10) + ', under the profile selected on this device. That is a check that the card says what the passage says, not clinical sign-off.',
    fact: { status: 'answer', cards: checked.map(hit => hit.card.id), set: first.set.id, waiting: waiting.map(hit => hit.card.id) } };
}
