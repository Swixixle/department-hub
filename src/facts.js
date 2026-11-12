// Reference knowledge: cards that answer in a captured page's own words, each line borne out by pictures of the page.
//
// This is general reference knowledge (a normal range, a definition), not a hospital's protocol. The page is held as a
// Blinders capture: its rendered text, byte for byte, and screenshots of it, each with the SHA-256 Blinders recorded.
// A card is a title, the wording a question may use, and the passages of the text it rests on. Nothing on a card is
// reworded, so there is no paraphrase for anyone to check. What is checked, by the app and by no person, is that the
// held files are the captured ones and that every line a card cites is in the screenshots: the same words in the same
// order, every number exactly. Cards that fail are refused. What no check here can settle is which passage a question
// wants; that rests on the card's wording, and the answer always shows the source's own text so a reader can see it.
import { stem, nearest, CORE_WORDS } from './words.js';
import { sealOf } from './protocols.js';
import { sha256 } from './audit.js';
import { witnessCard, shotOf } from './witness.js';
import { setFingerprint, checksForFact } from './assurance.js';

export const CARD_FORMAT = 'department-hub-fact-cards-v3';
export const EARLIER_FORMATS = ['department-hub-fact-cards-v1', 'department-hub-fact-cards-v2'];
export const NOT_A_PROTOCOL = 'Reference knowledge. It is not your hospital’s protocol and not an order for any patient.';
export const WITNESS = 'Checked by the app, not by a person: the held page and screenshots matched their capture receipts, and every line this card shows was found in the screenshots with every number exactly as captured.';

const refuse = why => ({ ok: false, why });
const COMMON = new Set(CORE_WORDS);
const words = text => String(text || '').toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9'/]+/g, ' ').trim().split(' ').filter(Boolean);
const stems = text => words(text).map(word => stem(word.replace(/'/g, '')));
const has = (sequence, phrase) => { const wanted = stems(phrase); return wanted.length > 0 && sequence.some((_, at) => wanted.every((word, offset) => sequence[at + offset] === word)); };
const setsOf = library => Array.isArray(library?.knowledge) ? library.knowledge : [];
// Only cards built on a held capture and borne out by its screenshots answer. Earlier sets rested on an AI reading
// of the page, or on a person comparing an AI's paraphrase with it.
const current = set => set?.format === CARD_FORMAT && typeof set.held?.text === 'string';
export const cite = set => set.source.title + ' · ' + set.source.publisher + (set.source.year ? ', ' + set.source.year : '') + ' · ' + set.source.licence;
export const shortDigest = digest => String(digest || '').slice(0, 8) + '…' + String(digest || '').slice(-6);
const hex = async bytes => sha256(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

// A passage is a run of the capture's lines, first to last inclusive, with the blank lines between them left out.
export const passageText = (text, [from, to]) => String(text).split('\n').slice(from, to + 1).filter(line => line.trim()).join('\n');
export const passagesOf = (set, card) => card.passages.map(range => passageText(set.held.text, range));
const sealed = (set, card) => sealOf({ source: set.source, applies: set.applies, card: { ...card, witness: { ...card.witness, seal: undefined } }, passages: passagesOf(set, card) });
export const cardHolds = (set, card) => current(set) && Boolean(card.witness?.ok) && card.witness.seal === sealed(set, card);

export function validateSet(set, held) {
  if (EARLIER_FORMATS.includes(set?.format)) return ['These cards are in an earlier format. Add the cards whose lines are borne out by screenshots of the page instead.'];
  if (set?.format !== CARD_FORMAT) return ['This is not a Department Hub reference card file.'];
  const problems = [], source = set.source || {}, capture = source.capture || {}, shots = source.screenshots;
  if (!set.id || !set.title) problems.push('The set needs an id and a title.');
  if (!source.title || !source.publisher || !source.licence || !/^\d{4}-\d{2}-\d{2}$/.test(source.readOn || '')) problems.push('The source needs a title, a publisher, a licence and the date it was read.');
  if (!/^https:\/\/[a-z0-9.-]+\//i.test(source.url || '')) problems.push('The source needs a secure web address a person can open.');
  if (!/^[0-9a-f]{64}$/.test(capture.sha256 || '') || !Number.isInteger(capture.bytes) || !capture.id) problems.push('The source needs the receipt of the capture it rests on: its id, byte count and SHA-256.');
  if (!Array.isArray(shots) || !shots.length || shots.some(shot => !shot.id || !/^[0-9a-f]{64}$/.test(shot.sha256 || '') || !Number.isInteger(shot.bytes))) problems.push('The source needs the receipts of the screenshots that bear the text out.');
  if (!Array.isArray(set.cards) || !set.cards.length) problems.push('The set has no cards.');
  const text = typeof held?.text === 'string' ? held.text : null, lines = text === null ? 0 : text.split('\n').length;
  if (text === null) problems.push('The captured page is not held, so no card can be checked against it.');
  const ids = new Set();
  for (const card of set.cards || []) {
    const name = '"' + (card.title || card.id) + '"';
    if (!card.id || ids.has(card.id)) problems.push('Every card needs its own id.');
    ids.add(card.id);
    if (!card.title) problems.push('Card ' + name + ' needs a title.');
    if ('answer' in card) problems.push('Card ' + name + ' carries its own wording of the answer. Cards answer only in the source’s words.');
    if (!card.where) problems.push('Card ' + name + ' does not say where in the source it comes from.');
    if (!Array.isArray(card.said) || !card.said.length) problems.push('Card ' + name + ' lists no wording to recognise it by.');
    const ranges = Array.isArray(card.passages) ? card.passages : [];
    if (!ranges.length || ranges.some(range => !Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger) || range[0] < 0 || range[1] < range[0] || range[1] >= lines)) {
      if (text !== null) problems.push('Card ' + name + ' cites a passage that is not in the captured page.');
    } else if (text !== null && ranges.some(range => !passageText(text, range))) problems.push('Card ' + name + ' cites a passage of blank lines.');
  }
  return problems;
}

// The held files must be the bytes Blinders saved. Checked by hashing, before anything else.
export async function verifyCapture(set, held) {
  const problems = [], check = async (what, receipt, data) => {
    if (data === undefined || data === null) { problems.push('The captured ' + what + ' is not held.'); return; }
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data), digest = await hex(bytes);
    if (digest !== receipt.sha256 || bytes.length !== receipt.bytes) problems.push('The held ' + what + ' is not the one captured: its SHA-256 is ' + shortDigest(digest) + ' (' + bytes.length + ' bytes), the receipt says ' + shortDigest(receipt.sha256) + ' (' + receipt.bytes + ' bytes).');
  };
  if (!set?.source?.capture) return ['The cards name no capture.'];
  await check('page', set.source.capture, held?.text);
  if (set.source.licenceCapture) await check('licence line', set.source.licenceCapture, held?.licence);
  for (const receipt of set.source.screenshots || []) await check('screenshot ' + receipt.id.slice(0, 8), receipt, (held?.shots || []).find(shot => shot.id === receipt.id)?.bytes);
  return problems;
}

// Boxes of matched words, gathered into one rectangle per printed line, so a passage can be outlined on its picture.
function outlines(boxes) {
  const rows = [];
  for (const box of [...boxes].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
    const row = rows.find(other => Math.min(other[3], box[3]) - Math.max(other[1], box[1]) > (box[3] - box[1]) * 0.5 && box[0] - other[2] < (box[3] - box[1]) * 3);
    if (row) { row[0] = Math.min(row[0], box[0]); row[1] = Math.min(row[1], box[1]); row[2] = Math.max(row[2], box[2]); row[3] = Math.max(row[3], box[3]); } else rows.push([...box]);
  }
  return rows;
}
// Where on which screenshot each passage of a card was found: a picture per passage and screenshot, cropped to the
// passage's lines with a margin, in the card's own order.
function picturesOf(result, shots) {
  const out = [];
  for (const [index, passage] of result.passages.entries()) {
    const byShot = new Map();
    for (const line of passage.boxes) if (line.shot) byShot.set(line.shot, [...(byShot.get(line.shot) || []), ...line.boxes]);
    for (const [id, boxes] of byShot) {
      const shot = shots.find(one => one.id === id), marks = outlines(boxes), pad = 28;
      const x0 = Math.max(0, Math.min(...marks.map(mark => mark[0])) - pad), y0 = Math.max(0, Math.min(...marks.map(mark => mark[1])) - pad);
      const x1 = Math.min(shot.width, Math.max(...marks.map(mark => mark[2])) + pad), y1 = Math.min(shot.height, Math.max(...marks.map(mark => mark[3])) + pad);
      out.push({ passage: index, shot: id, width: shot.width, height: shot.height, crop: [x0, y0, x1 - x0, y1 - y0], marks });
    }
  }
  return out;
}

// Takes in a set only if every card is borne out. `held` carries the page, its licence line and each screenshot's
// bytes, size and readings (made by the app's text reader). The readings are used here and not kept.
// Earlier-format sets it replaces are withdrawn with the reason recorded.
export async function addSet(library, set, held, who, at) {
  const problems = [...await verifyCapture(set, held), ...validateSet(set, held)];
  if (problems.length) return { ok: false, why: 'The cards were not added. ' + problems[0], problems };
  if (setsOf(library).some(other => other.id === set.id && !other.withdrawn)) return refuse('These reference cards are already held.');
  const shots = (set.source.screenshots || []).map(receipt => { const shot = held.shots.find(one => one.id === receipt.id); return { ...shotOf(receipt.id, shot.readings || []), width: shot.width, height: shot.height }; });
  const base = { ...set, held: { text: held.text, licence: held.licence ?? null }, shots: shots.map(({ id, width, height }) => ({ id, width, height })) };
  const failed = [], cards = set.cards.map(({ review, witness, ...card }) => {
    const result = witnessCard(passagesOf(base, card), shots);
    if (!result.ok) failed.push(card.title + ' (' + result.matched + ' of ' + result.words + ' words found' + (result.passages.some(one => one.missingNumbers.length) ? '; a number was not found: ' + result.passages.flatMap(one => one.missingNumbers).join(', ') : '') +
      (result.passages.some(one => one.contradictions.length) ? '; the screenshot shows other words: ' + result.passages.flatMap(one => one.contradictions).map(one => one.shown).join(', ') : '') + ')');
    const filed = { ...card, witness: { ok: result.ok, words: result.words, matched: result.matched, pictures: result.ok ? picturesOf(result, shots) : [] } };
    return { ...filed, witness: { ...filed.witness, seal: sealed(base, filed) } };
  });
  if (failed.length) return { ok: false, why: 'The cards were not added. The screenshots do not bear out ' + failed.length + ' of them: ' + failed.join('; ') + '.', problems: failed };
  const replaced = setsOf(library).filter(other => !other.withdrawn && (set.replaces || []).includes(other.id));
  const reason = 'Replaced by cards in the source’s own words, borne out by screenshots of the page (' + set.source.capture.tool + ' capture ' + set.source.capture.id + ').';
  const fingerprint = await setFingerprint(set), taken = { ...base, cards, fingerprint, added: { by: who, at }, withdrawn: null };
  const kept = setsOf(library).filter(other => other.id !== set.id).map(other => replaced.includes(other) ? { ...other, withdrawn: { by: who, at, reason } } : other);
  const words = cards.reduce((sum, card) => sum + card.witness.words, 0), matched = cards.reduce((sum, card) => sum + card.witness.matched, 0);
  return { ok: true, library: { ...library, knowledge: [...kept, taken] }, set: taken, replaced: replaced.map(other => other.id),
    receipt: { type: 'Reference cards added', details: { set: set.id, title: set.title, cards: cards.length, source: set.source.url, licence: set.source.licence,
      capture: set.source.capture.id, sha256: set.source.capture.sha256, bytes: set.source.capture.bytes, captured: set.source.capture.savedAt,
      screenshots: set.source.screenshots.map(shot => shot.id + ' ' + shot.sha256), found: matched + ' of ' + words + ' words, every number', fingerprint, replaced: replaced.map(other => other.id), note: WITNESS } } };
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
  const holding = best.filter(hit => cardHolds(hit.set, hit.card)), broken = best.filter(hit => !cardHolds(hit.set, hit.card));
  // A card whose stored check no longer matches it (edited after it was added) says nothing.
  if (!holding.length) return { ...base, title: 'A reference card on this is held, and it no longer matches the check made when it was added', understood: 'reference knowledge: ' + broken[0].card.title.toLowerCase(),
    lines: ['It gives no answer. Withdraw the cards and add them again.'], items: [{ text: broken[0].set.title, sub: 'Open the cards', go: 'knowledge|' + broken[0].set.id }],
    source: cite(broken[0].set), fact: { status: 'broken', cards: broken.map(hit => hit.card.id) } };
  const first = holding[0], capture = first.set.source.capture, related = first.set.cards.filter(card => cardHolds(first.set, card) && !holding.some(hit => hit.card.id === card.id)).map(card => card.title);
  return { ...base, title: holding.length === 1 ? 'From the source: ' + first.card.title : 'From the source: ' + holding.map(hit => hit.card.title).join('; '),
    understood: 'reference knowledge: ' + holding.map(hit => hit.card.title.toLowerCase()).join('; '),
    lines: [NOT_A_PROTOCOL + ' ' + first.set.applies],
    items: holding.map(({ set, card }) => ({ text: 'The source’s own words · ' + card.where, quote: passagesOf(set, card), pictures: card.witness.pictures, href: set.source.url, card: card.id, checks: checksForFact(set, card, world.today),
      sub: [set.source.publisher + (set.source.year ? ', ' + set.source.year : ''), set.source.licence,
        'exact text captured with ' + set.source.capture.tool + ' on ' + set.source.capture.savedAt.slice(0, 10) + ', SHA-256 ' + shortDigest(set.source.capture.sha256),
        'found on the page’s screenshots: ' + card.witness.matched + ' of ' + card.witness.words + ' words, every number'].join(' · ') })),
    next: related.slice(0, 4), source: 'Reference cards resting on ' + cite(first.set) + ', held as ' + capture.tool + ' capture ' + capture.id + ' with ' + first.set.source.screenshots.length + ' screenshots. ' + WITNESS,
    fact: { status: 'answer', cards: holding.map(hit => hit.card.id), set: first.set.id } };
}
