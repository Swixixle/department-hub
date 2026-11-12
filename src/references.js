// Professional references: a list of where published guidelines are, and nothing about what they say.
//
// This is the third kind of source in the app, and the weakest. A hospital protocol held here is the original file,
// with a checked reading and reviewed answers. A pasted document is searched by its words. A professional reference
// is a title, a year, who lists it and a link to the publisher's own copy. Department Hub holds none of its text,
// so it can point to a guideline and can never answer from one. A listing does not say the document is current, and
// it does not say the hospital has adopted it: only a held, reviewed protocol speaks for the department.
import { keywords, stem } from './words.js';

// Ways people shorten the words a title spells out.
const SPOKEN = { vent: 'ventilator ventilation', vents: 'ventilator ventilation', o2: 'oxygen', abg: 'gas', abgs: 'gas', cbg: 'capillary', trach: 'tracheostomy', trachs: 'tracheostomy', peds: 'pediatric', kid: 'pediatric', kids: 'pediatric',
  child: 'pediatric', children: 'pediatric', baby: 'neonatal infant', babies: 'neonatal infant', newborn: 'neonatal', newborns: 'neonatal', infant: 'neonatal', infants: 'neonatal', pft: 'function spirometry', pfts: 'function spirometry',
  sbt: 'spontaneous', niv: 'noninvasive', nippv: 'noninvasive', bipap: 'noninvasive', ino: 'nitric', ett: 'endotracheal', extubation: 'removal', extubate: 'removal', extubating: 'removal', weaning: 'liberation', wean: 'weaning liberation',
  vap: 'pneumonia', osa: 'apnea', cf: 'cystic', etco2: 'capnography', cpr: 'resuscitation', neb: 'aerosol', nebs: 'aerosol', nebulizer: 'aerosol', nebulizers: 'aerosol', inhaler: 'aerosol', inhalers: 'aerosol' };
// Words in nearly every title, or in the question rather than the subject. A match on these alone finds nothing.
const GENERIC = new Set(('aarc nbrc guideline guidelines clinical practice evidence based reference references standard standards statement recommendation recommendations professional published official ' +
  'patient patients care management setting acute health use during with from for the and their effect effectiveness therapy therapies selection device hospital hospitalized respiratory ' +
  'anything something there what which where does have about says say latest newest current list show find any some our your').split(' ').map(stem));
const NAMES_A_REFERENCE = /\b(?:aarc|nbrc|cpgs?|clinical practice guidelines?|professional references?|practice guidelines?)\b/i;
const ASKS_FOR_ONE = /\b(?:guidelines?|references?|standards?|recommendations?|evidence|literature|published)\b/i;
// "ventilator" and "ventilation", "neonatal" and "neonates" are one subject; "cardiopulmonary" and "cardiovascular" are not.
const trim = word => word.length > 6 ? word.replace(/(?:ations?|ators?|ating|ated|ates?|ives?|ics?|ies|ing|als?|ed|es|y|s)$/, '') : word;
const root = word => trim(trim(word));
const sameStem = (a, b) => a === b || root(a) === root(b);
const wordsOf = text => keywords(String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' '));
// Each word of a question, with the other ways a title might say it. "vent" is one subject whether the title says
// ventilator or ventilation, so it counts once however many of those a title contains.
const subjectsOf = question => String(question || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean)
  .map(word => ({ said: word, ways: wordsOf(SPOKEN[word] ? word + ' ' + SPOKEN[word] : word) })).filter(subject => subject.ways.length && !subject.ways.every(way => GENERIC.has(way)))
  .filter((subject, index, all) => all.findIndex(other => other.ways.join() === subject.ways.join()) === index);
const thisYear = today => Number(String(today || '').slice(0, 4)) || new Date().getFullYear();
const KIND_NOTE = { credential_resource: 'Credentialing information, not a clinical protocol.', professional_news: 'News and announcements. News is not clinical policy.',
  educational_technical_article: 'An educational article. Where it is hosted does not make it an order set.', professional_guidance: 'Professional guidance about the field, not a bedside procedure.' };

// What a reader must be told about one entry before opening it. Every line is worked out from the listing itself.
export function cautionsFor(record, records, today) {
  const cautions = [], age = record.year ? thisYear(today) - record.year : null;
  if (record.retired) cautions.push('Retired by AARC. Kept as history, not as a reference for practice.');
  if (KIND_NOTE[record.kind]) cautions.push(KIND_NOTE[record.kind]);
  if (record.kind === 'external_guideline_or_standard') cautions.push('Issued by another organization and listed by AARC. The link is the one AARC gives. It may have moved, and its issuer may have published a newer edition.');
  if (age !== null && age >= 10) cautions.push('Dated ' + record.year + ', ' + age + ' years ago. Check with whoever issued it for something newer.');
  if (age === null && !KIND_NOTE[record.kind]) cautions.push('The listing gives no year.');
  const later = (record.related || []).map(id => records.find(other => other.id === id)).filter(other => other && other.year && record.year && other.year > record.year);
  for (const other of later) cautions.push('AARC also lists a later document on this subject: ' + other.short + '.');
  if (record.versionNote) cautions.push(record.versionNote);
  return cautions;
}

// Looks through titles and AARC's own topic headings, never through any guideline's text (none is held). Retired
// documents are left out unless asked for. Most words matched first, then current before retired, then newest.
// The reference screen also matches the broad grouping ("Sleep"), ranked below a match in the title.
export function searchReferences(records, query, { retired = false, section = '', groups = false } = {}) {
  const wanted = subjectsOf(query), pool = records.filter(record => (retired || !record.retired) && (!section || record.section === section));
  if (!String(query || '').trim()) return pool.map(record => ({ record, hits: 0 }));
  if (!wanted.length) return [];
  const within = (subject, held) => subject.ways.some(way => held.some(other => sameStem(way, other)));
  return pool.map(record => { const named = wordsOf(record.title + ' ' + (record.topic || '')), grouped = groups ? wordsOf(record.groups.join(' ')) : [];
    const hits = wanted.filter(subject => within(subject, named)).length;
    return { record, hits: hits || (wanted.some(subject => within(subject, grouped)) ? 0.5 : 0) }; })
    .filter(found => found.hits > 0).sort((a, b) => b.hits - a.hits || Number(a.record.retired) - Number(b.record.retired) || (b.record.year || 0) - (a.record.year || 0) || a.record.short.localeCompare(b.record.short));
}

const SOURCE = collected => 'A list of titles and links collected from AARC’s and NBRC’s public pages on ' + collected + '. Department Hub holds none of these documents and has not checked that any is current. It is not your hospital’s protocol.';

// An answer made only of pointers. `fallback` is set when the rest of Ask found nothing: then a reference is offered
// only if the question asks for one or names a subject a title names, so an unanswered schedule question stays unanswered.
export function referenceAnswer(question, world, { fallback = false } = {}) {
  const records = world.references || [];
  if (!records.length) return null;
  const named = NAMES_A_REFERENCE.test(question), asked = ASKS_FOR_ONE.test(question), wanted = subjectsOf(question), words = wanted.map(subject => subject.said).join(' ');
  if (!fallback && !named) return null;
  const issuer = /\bnbrc\b/i.test(question) ? 'NBRC' : null;
  let found = searchReferences(issuer ? records.filter(record => record.issuer.startsWith('NBRC')) : records, words);
  // "Anything new from NBRC?" matches no title. NBRC's short list is the answer: where its news and documents are.
  if (!found.length && issuer) found = records.filter(record => record.issuer.startsWith('NBRC')).map(record => ({ record, hits: 1 }));
  // A subject AARC lists only retired documents for: say so, and do not link to them from an answer.
  const retiredOnly = found.length ? [] : searchReferences(records, words, { retired: true });
  if (retiredOnly.length && (named || asked)) return { kind: 'reference', empty: false, title: 'Only retired documents are listed on this', understood: 'a search of the professional reference list', read: '', changes: [], next: [],
    lines: ['AARC lists ' + retiredOnly.length + ' retired document' + (retiredOnly.length === 1 ? '' : 's') + ' whose title matches, and nothing current. A retired guideline is history, not a reference for practice. Ask whoever keeps your department’s protocols what applies.'],
    items: [{ text: 'See the retired listing' + (retiredOnly.length === 1 ? '' : 's') + ' in the reference list', sub: 'Marked as retired', go: 'refs|' + encodeURIComponent(words) + '|retired' }],
    source: SOURCE(world.referencesCollected || 'an earlier date'), context: { kind: 'reference' }, reference: { ids: [], retired: retiredOnly.map(hit => hit.record.id) } };
  if (!found.length) {
    if (!named) return null;
    return { kind: 'reference', empty: false, title: 'No professional reference in the list is titled for that', lines: ['The list holds ' + records.length + ' titles from AARC and NBRC. It is searched by title and topic only, because none of the documents themselves are held here.'],
      items: [{ text: 'Browse the professional references', sub: 'Titles and links to official originals', go: 'refs|' }], source: SOURCE(world.referencesCollected || 'an earlier date'), understood: 'a search of the professional reference list', read: '', changes: [], next: [],
      context: { kind: 'reference' }, reference: { ids: [] } };
  }
  const best = found[0].hits;
  // Without a word like "guideline", a loose match on one word of several is not offered.
  if (fallback && !named && !asked && (best < Math.min(2, wanted.length) || wanted.every(subject => subject.said.length < 5))) return null;
  // Every title that matches as well as the best one. A lone best match that does not cover everything asked is shown
  // with the next-best beside it, so one title that happens to share two words is not presented as the answer.
  const top = found.filter(hit => hit.hits === best), wider = top.length === 1 && best < wanted.length, shown = (wider ? found : top).slice(0, wider ? 5 : 7), year = thisYear(world.today);
  const held = searchReferences(records, words, { retired: true }).filter(hit => hit.record.retired && hit.hits === best).length;
  const dated = record => !record.year ? 'no year listed' : year - record.year >= 10 ? record.year + ', ' + (year - record.year) + ' years old: check for a newer edition' : String(record.year);
  return { kind: 'reference', empty: false, title: fallback && !named && !asked ? 'Nothing in the department’s own records answers this. Published references on the subject:' : 'Professional references on this. They are not your hospital’s protocol.',
    lines: ['Department Hub holds none of their text and does not summarise them. Open the official original and read it there, with its conditions and exceptions. What your hospital has adopted is a separate question.',
      ...(held ? [held + ' retired document' + (held === 1 ? '' : 's') + ' on this ' + (held === 1 ? 'is' : 'are') + ' not shown. ' + (held === 1 ? 'It is' : 'They are') + ' in the reference list, marked as retired.'] : [])],
    items: [...shown.map(({ record }) => ({ text: record.title, href: record.url, reference: record.id,
      sub: [record.section, record.kind === 'external_guideline_or_standard' ? 'another organization’s document, as listed by AARC' : record.issuer, dated(record),
        ...cautionsFor(record, records, world.today).filter(caution => /later document|in press|not a clinical|not clinical|order set|not a bedside/.test(caution))].join(' · ') })),
      { text: 'See these in the professional reference list', sub: 'With what each listing does and does not establish', go: 'refs|' + encodeURIComponent(words) }],
    source: SOURCE(world.referencesCollected || 'an earlier date'), understood: 'a search of the professional reference list', read: '', changes: [], next: [], context: { kind: 'reference' }, reference: { ids: shown.map(hit => hit.record.id) } };
}

export const namesAReference = question => NAMES_A_REFERENCE.test(String(question || ''));
