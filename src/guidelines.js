// Guideline cards: what a copyrighted guideline recommends, restated in fixed sentences, its text never shipped.
//
// A guideline whose text the app may not show is captured exactly with Blinders and kept on the owner's computer.
// From it, a build step makes cards: each is a sentence pattern filled with values taken from one passage of the
// capture ("{what}: {value}, {when}"), or a pointer to a recommendation that is reasoning rather than a value
// ("Recommendation 3 is about …; read it in your copy"). Every number on a card must be in its passage, exactly. The
// app ships the cards, where each passage is, and a fingerprint of its words, not the passage.
//
// No one is asked to trust the build. Every member of the department can capture the guideline from their own access
// and give the app their copy: it finds each card's passage by its fingerprint and checks every number again. Whether
// a sentence says what the passage means is the one thing a machine cannot settle, so a member who has compared the
// card with the passage in their own copy records that; until someone has, the card says so.
import { stem, nearest, CORE_WORDS } from './words.js';
import { sha256 } from './audit.js';
import { sealOf } from './protocols.js';
import { tokensOf, isNumber } from './witness.js';

export const GUIDELINE_FORMAT = 'department-hub-guideline-cards-v1';
export const RESTATED = 'Restated in Department Hub’s own fixed wording from the guideline named. It is not the guideline’s text, not your hospital’s protocol, and not an order for any patient.';
const refuse = why => ({ ok: false, why });
const COMMON = new Set(CORE_WORDS);
const words = text => String(text || '').toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9'/]+/g, ' ').trim().split(' ').filter(Boolean);
const stems = text => words(text).map(word => stem(word.replace(/'/g, '')));
const has = (sequence, phrase) => { const wanted = stems(phrase); return wanted.length > 0 && sequence.some((_, at) => wanted.every((word, offset) => sequence[at + offset] === word)); };
const setsOf = library => Array.isArray(library?.guidelines) ? library.guidelines : [];
const bare = token => token.replace(/^[<>≤≥]/, '').replace(/-$/, '');
// The numbers a card or passage states, each as written ("0.5", "30-120", "<105").
export const numbersIn = text => tokensOf(text).filter(isNumber).map(bare);

// A passage's lines, blank lines left out, and the fingerprint of its words: lower case, punctuation and line breaks
// ignored, so a member's own capture of the same page, saved in another browser, finds the same passage.
export const linesOf = (text, [from, to]) => String(text).split('\n').slice(from, to + 1).filter(line => line.trim());
export const passageFingerprint = async tokens => (await sha256('department-hub/guideline-passage-v1:' + tokens.join(' '))).slice(0, 32);

// The card's sentence, from its pattern. Only these patterns exist; a card cannot carry free text.
export function sentenceOf(card) {
  const f = card.fields || {};
  if (card.kind === 'value') return f.what + ': ' + f.value + (f.unit ? ' ' + f.unit : '') + (f.when ? ', ' + f.when : '') + '.';
  if (card.kind === 'recommendation') return 'Recommendation ' + f.number + ' (' + f.strength + '): ' + f.about + '.';
  return '';
}
const FIELDS = { value: ['what', 'value'], recommendation: ['number', 'strength', 'about'] };
const LIMITS = { what: 80, value: 60, unit: 20, when: 120, number: 4, strength: 80, about: 140 };
// The numbers a card states and its passage must hold. A recommendation's own number is checked against its heading instead.
const statedNumbers = card => numbersIn(Object.entries(card.fields || {}).filter(([key]) => key !== 'number').map(([, value]) => value).join(' '));

// Checks one card against its passage of the owner's capture: the passage exists, and every number the card states
// is in it. A recommendation card's `about` names a subject, so it may hold no number at all.
export function checkCard(card, text) {
  const problems = [], name = '"' + (card.title || card.id) + '"', f = card.fields || {};
  if (!FIELDS[card.kind]) return ['Card ' + name + ' is of no known kind.'];
  for (const key of FIELDS[card.kind]) if (!String(f[key] || '').trim()) problems.push('Card ' + name + ' is missing ' + key + '.');
  for (const [key, value] of Object.entries(f)) if (!(key in LIMITS) || String(value).length > LIMITS[key]) problems.push('Card ' + name + ' has a field it may not have, or one too long: ' + key + '.');
  const lines = text.split('\n').length, range = card.passage;
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger) || range[0] < 0 || range[1] < range[0] || range[1] >= lines) return [...problems, 'Card ' + name + ' cites a passage that is not in the capture.'];
  const passage = linesOf(text, range), present = new Set(numbersIn(passage.join(' ')));
  if (!passage.length) problems.push('Card ' + name + ' cites blank lines.');
  const missing = statedNumbers(card).filter(number => !present.has(number));
  if (missing.length) problems.push('Card ' + name + ' states ' + missing.join(', ') + ', which its passage does not contain.');
  if (card.kind === 'recommendation') {
    // The recommendation's number is the number of the section heading above it ("PICO 2", "Recommendation 2").
    const heading = text.split('\n').slice(0, range[0]).reverse().map(line => line.trim().match(/^(?:PICO|Recommendation|Question)\s+(\d+)\b/i)).find(Boolean);
    if (!heading || heading[1] !== String(f.number)) problems.push('Card ' + name + ' says it is recommendation ' + f.number + ', but the section its passage sits in is ' + (heading ? heading[1] : 'not numbered') + '.');
    if (!/\brecommendation\b/i.test(passage.join(' '))) problems.push('Card ' + name + ' cites a passage that is not a recommendation.');
  }
  return problems;
}

// The build step, run on the owner's computer with the capture: checks every card and writes what ships. The capture
// itself is not part of what ships, only its receipt and one fingerprint per passage.
export async function buildSet(spec, text, receipt) {
  const problems = [];
  if (!spec?.id || !spec.title || !spec.source?.title || !spec.source?.issuer || !spec.source?.year || !/^https:\/\//.test(spec.source?.url || '')) problems.push('The guideline needs an id, a title, its issuer, year and a secure address.');
  if (!receipt?.id || !/^[0-9a-f]{64}$/.test(receipt.sha256 || '')) problems.push('The guideline needs the receipt of the capture it was built from.');
  if (receipt && (await sha256(text)) !== receipt.sha256) problems.push('The capture is not the one its receipt describes.');
  const ids = new Set();
  for (const card of spec.cards || []) { if (ids.has(card.id)) problems.push('Two cards share the id ' + card.id + '.'); ids.add(card.id); if (!Array.isArray(card.said) || !card.said.length) problems.push('Card "' + card.id + '" lists no wording to recognise it by.'); problems.push(...checkCard(card, text)); }
  if (!(spec.cards || []).length) problems.push('The guideline has no cards.');
  if (problems.length) return { ok: false, problems };
  const cards = [];
  for (const card of spec.cards) {
    const tokens = tokensOf(linesOf(text, card.passage).join(' '));
    cards.push({ id: card.id, kind: card.kind, title: card.title, said: card.said, where: card.where, fields: card.fields,
      passage: { words: tokens.length, starts: tokens[0], fingerprint: await passageFingerprint(tokens), numbers: statedNumbers(card) } });
  }
  return { ok: true, set: { format: GUIDELINE_FORMAT, id: spec.id, title: spec.title, applies: spec.applies, source: { ...spec.source, capture: { tool: receipt.tool || 'Blinders', id: receipt.id, sha256: receipt.sha256, bytes: receipt.bytes, savedAt: receipt.saved_at || receipt.savedAt } }, cards } };
}

// Finds a card's passage in a member's own capture: any run of that many words, wherever its lines break, whose
// fingerprint is the same. `tokens` may be passed in when many cards are looked for in one copy.
export async function findIn(card, text, tokens = tokensOf(text)) {
  const size = card.passage.words;
  for (let at = 0; at + size <= tokens.length; at++) {
    if (card.passage.starts && tokens[at] !== card.passage.starts) continue;
    const run = tokens.slice(at, at + size);
    if (await passageFingerprint(run) === card.passage.fingerprint) {
      const present = new Set(run.filter(isNumber).map(bare));
      return { found: true, numbers: card.passage.numbers.every(number => present.has(number)), at };
    }
  }
  return { found: false, numbers: false };
}

const sealed = (set, card) => sealOf({ source: set.source, card: { id: card.id, kind: card.kind, fields: card.fields, passage: card.passage, said: card.said } });
const compared = (set, card) => (card.compared || []).filter(entry => entry.seal === sealed(set, card));

export function addGuideline(library, set, who, at) {
  if (set?.format !== GUIDELINE_FORMAT || !Array.isArray(set.cards) || !set.cards.length) return refuse('This is not a Department Hub guideline card file.');
  if (setsOf(library).some(other => other.id === set.id && !other.withdrawn)) return refuse('These guideline cards are already held.');
  const taken = { ...set, cards: set.cards.map(({ compared, matched, ...card }) => card), added: { by: who, at }, withdrawn: null };
  return { ok: true, library: { ...library, guidelines: [...setsOf(library).filter(other => other.id !== set.id), taken] },
    receipt: { type: 'Guideline cards added', details: { set: set.id, title: set.title, cards: set.cards.length, capture: set.source.capture.id, sha256: set.source.capture.sha256,
      note: 'Restated in fixed wording; every number was found in its passage of the owner’s capture. Not yet compared by anyone with their own copy.' } } };
}

// A member gives the app their own capture of the guideline. Each card whose passage is found, word for word, with
// every number, is marked as found in that member's copy. Nothing of their copy is kept.
export async function matchCopy(library, setId, text, who, at) {
  const set = setsOf(library).find(held => held.id === setId);
  if (!set || set.withdrawn) return refuse('Those guideline cards are not held.');
  const results = [];
  const tokens = tokensOf(text);
  for (const card of set.cards) results.push([card.id, await findIn(card, text, tokens)]);
  const found = results.filter(([, result]) => result.found && result.numbers).map(([id]) => id), missing = results.filter(([, result]) => !(result.found && result.numbers)).map(([id]) => id);
  if (!found.length) return refuse('None of the cards’ passages is in that copy. Make sure it is a Blinders capture of the same guideline, from the article page.');
  return { ok: true, found, missing, library: { ...library, guidelines: setsOf(library).map(held => held.id !== setId ? held : { ...held, cards: held.cards.map(card => found.includes(card.id) ? { ...card, matched: [...(card.matched || []).filter(entry => entry.by !== who), { by: who, at, seal: sealed(held, card) }] } : card) }) },
    receipt: { type: 'Guideline cards found in a member’s copy', details: { set: setId, by: who, found: found.length, missing: missing.length, note: 'The member’s copy is not kept. Each found card’s passage matched word for word, with every number.' } } };
}

// After their copy has the passage, a member who has read it there records that the card says the same.
export function compareCard(library, setId, cardId, who, at) {
  const set = setsOf(library).find(held => held.id === setId), card = set?.cards.find(entry => entry.id === cardId);
  if (!set || !card || set.withdrawn) return refuse('That guideline card is not held.');
  if (!(card.matched || []).some(entry => entry.by === who && entry.seal === sealed(set, card))) return refuse('Give the app your own copy of the guideline first, so it can find this card’s passage in it.');
  return { ok: true, library: { ...library, guidelines: setsOf(library).map(held => held.id !== setId ? held : { ...held, cards: held.cards.map(entry => entry.id !== cardId ? entry : { ...entry, compared: [...(entry.compared || []).filter(one => one.by !== who), { by: who, at, seal: sealed(held, entry) }] }) }) },
    receipt: { type: 'Guideline card compared with a member’s copy', details: { set: setId, card: card.title, by: who, note: 'Read against the passage in their own copy of the guideline. A check of wording, not clinical sign-off.' } } };
}

export function withdrawGuideline(library, setId, reason, who, at) {
  const set = setsOf(library).find(held => held.id === setId);
  if (!set || set.withdrawn) return refuse('Those guideline cards are not held.');
  if (!String(reason || '').trim()) return refuse('Say why the cards are being withdrawn. The reason is kept with the record.');
  return { ok: true, library: { ...library, guidelines: setsOf(library).map(held => held.id !== setId ? held : { ...held, withdrawn: { by: who, at, reason: String(reason).trim() } }) },
    receipt: { type: 'Guideline cards withdrawn', details: { set: setId, title: set.title, reason: String(reason).trim() } } };
}

export const comparedBy = (set, card) => compared(set, card).map(entry => entry.by);
export const sentence = sentenceOf;

// Ask: a question in a card's own wording gets the card's sentence, where it is in the guideline, and whether anyone
// has compared it with their own copy yet.
export function guidelineAnswer(question, world) {
  const live = setsOf(world.protocols).filter(set => !set.withdrawn && set.format === GUIDELINE_FORMAT);
  if (!live.length || !String(question || '').trim()) return null;
  const known = new Set(live.flatMap(set => set.cards.flatMap(card => card.said.flatMap(words))).filter(word => word.length >= 5)), changes = [];
  const read = words(question).map(word => { if (word.length < 5 || /\d/.test(word) || known.has(word) || COMMON.has(word)) return word; const fixed = nearest(word, known); if (fixed && fixed !== word) { changes.push([word, fixed]); return fixed; } return word; }).join(' '), sequence = stems(read);
  const hits = live.flatMap(set => set.cards.map(card => ({ set, card, score: Math.max(0, ...card.said.filter(phrase => has(sequence, phrase)).map(phrase => stems(phrase).length)) }))).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score);
  if (!hits.length) return null;
  const best = hits.filter(hit => hit.score === hits[0].score).slice(0, 3), first = best[0].set;
  return { kind: 'guideline', empty: false, read: changes.length ? read : '', changes, next: [], context: { kind: 'guideline' },
    title: best.length === 1 ? sentenceOf(best[0].card) : first.source.issuer + ' ' + first.source.year + ' on this:',
    understood: 'a guideline card: ' + best.map(hit => hit.card.title.toLowerCase()).join('; '),
    lines: [...(best.length > 1 ? best.map(hit => sentenceOf(hit.card)) : []), RESTATED + (first.applies ? ' ' + first.applies : '')],
    items: [...best.map(({ set, card }) => { const by = comparedBy(set, card);
      return { text: set.source.title + ' · ' + card.where, href: set.source.url, card: card.id,
        sub: [set.source.issuer + ', ' + set.source.year, 'every number checked against an exact capture of the guideline',
          by.length ? 'compared with the guideline by ' + by.join(' and ') : 'not yet compared with the guideline by a second person', 'read it in your own copy'].join(' · ') }; }),
      { text: 'See these cards, and check them against your own copy', sub: 'Every card from this guideline, and who has compared it', go: 'guideline|' + first.id }],
    source: first.source.title + ' (' + first.source.issuer + ', ' + first.source.year + '). ' + first.source.rights,
    guideline: { set: first.id, cards: best.map(hit => hit.card.id) } };
}
