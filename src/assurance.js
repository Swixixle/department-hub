// What an answer from a held source has, and has not, been checked for — named one by one, never one green badge.
// Also: whether the source is known to be the current edition, and a fingerprint of a card set as it ships, so any
// member can compare the cards in their copy of the app with the copy kept on GitHub.
import { sha256 } from './audit.js';

// Whether a source was checked as the newest edition, and how long ago. Past `recheckMonths` it is due again.
export function freshness(source, today) {
  const current = source?.current;
  if (!current?.checkedOn) return { state: 'unknown', label: 'Not checked for a newer edition' };
  const [y, m] = current.checkedOn.split('-').map(Number), [ty, tm] = String(today || '').slice(0, 7).split('-').map(Number);
  const months = ty && tm ? (ty - y) * 12 + (tm - m) : 0, due = months >= (current.recheckMonths || 12);
  return { state: due ? 'due' : 'current', checkedOn: current.checkedOn, how: current.how,
    label: due ? 'Last checked as the newest edition on ' + current.checkedOn + ', ' + months + ' months ago: check for a newer one' : 'Checked as the newest edition on ' + current.checkedOn };
}

// One check: what it is, and whether this answer passed it. `open` checks are shown as not done, not hidden.
const check = (label, done, note = '') => ({ label, done: Boolean(done), note });

export function checksForFact(set, card, today) {
  const fresh = freshness(set.source, today);
  return [check('Page and screenshots match their Blinders receipts', true), check('Every line found on the page’s screenshots', card.witness?.ok),
    check('Every number exactly as captured', card.witness?.ok), check('Nothing reworded: the source’s own words', true), check(fresh.label, fresh.state === 'current')];
}

export function checksForGuideline(set, card, comparedBy, today) {
  // A member's own copy and their comparison are extra witnesses: shown when they exist, never shown as a gap. The word
  // check is what stands in for a second reader. A card built before that check says so, as a check not passed.
  const fresh = freshness(set.source, today), found = (card.matched || []).length > 0, by = comparedBy(set, card), worded = (card.passage?.checked || []).includes('words');
  return [check('Every number checked against an exact capture of the guideline', true),
    check(worded ? 'Every word of the card found in its passage, negations kept' : 'Words not checked against the passage (built before that check)', worded),
    check('Restated in fixed wording, not the guideline’s text', true),
    ...(set.replacedBy ? [check('Replaced by a newer guideline: ' + set.replacedBy.title, false)] : []),
    ...(found ? [check('Passage also found in a member’s own copy', true)] : []), ...(by.length ? [check('Compared with the guideline by ' + by.join(' and '), true)] : []),
    check(fresh.label, fresh.state === 'current')];
}

// A card set as it ships: the file's own fields, not what the app adds when it holds the set (checks, who compared
// what, the held page). Written with keys in a fixed order so the same content always gives the same fingerprint.
const RUNTIME_SET = ['held', 'shots', 'added', 'withdrawn', 'fingerprint'], RUNTIME_CARD = ['witness', 'matched', 'compared', 'review'];
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
export const shippedFormOf = set => Object.fromEntries(Object.entries(set).filter(([key]) => !RUNTIME_SET.includes(key))
  .map(([key, value]) => [key, key === 'cards' ? value.map(card => Object.fromEntries(Object.entries(card).filter(([field]) => !RUNTIME_CARD.includes(field)))) : value]));
export const setFingerprint = async set => sha256('department-hub/card-set-v1:' + canonical(shippedFormOf(set)));
export const shortPrint = print => String(print || '').slice(0, 12);
