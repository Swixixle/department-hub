// Signs that a piece of writing points to a particular patient. This is a screen, not a guarantee: it knows the common
// shapes (a record number, a birth date, an age written the clinical way, a patient with a room or a name) and misses
// anything written another way. It never sends the words anywhere. Links are left out, because a video address is often
// a long number.
//
// A word on its own is not a sign. "Check the date of birth" is a reminder; "DOB 3/4/1951" is a birth date. A stop needs
// the value, or a particular patient, so that ordinary teaching and ordinary contact details are not refused.
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const FULL_DATE = '(?:\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|' + MONTH + '\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}\\s+' + MONTH + ',?\\s+\\d{4})';
const ANY_DATE = '(?:' + FULL_DATE + '|\\d{1,2}[\\/.-]\\d{1,2}|' + MONTH + '\\s+\\d{1,2}(?:st|nd|rd|th)?)';
const SAID = '(?:\\s+(?:number|no\\.?|num|is|was|#))*\\s*[:#=]?\\s*';
const SHAPES = [
  ['a Social Security number', new RegExp('\\b\\d{3}-\\d{2}-\\d{4}\\b|\\b(?:ssn|social security)\\b' + SAID + '\\d[\\d -]{2,10}\\d', 'i')],
  ['a record or account number', new RegExp('\\b(?:mrn|m\\.r\\.n\\.?|medical record|csn|(?:patient|pt)\\s+id)(?![a-z])' + SAID + '[a-z]{0,2}\\d{3,}', 'i')],
  // "account", "encounter" and the like are ordinary words, so they need a number marker or a long number after them
  ['a record or account number', /\b(?:fin|acct|account|encounter|visit|chart)\b(?:(?:\s+(?:number|no\.?|num|#))+\s*(?:is\s+)?[:#=]?\s*\d{3,}|\s*[:#=]\s*\d{3,}|\s+\d{5,})/i],
  ['a date of birth', new RegExp('\\b(?:dob|d\\.o\\.b\\.?|date of birth|birth\\s?date)(?![a-z])(?:\\s+(?:is|was|of))?\\s*[:=]?\\s*' + ANY_DATE + '|\\bborn\\s+(?:on\\s+)?' + FULL_DATE, 'i')],
  ['a patient’s age', /\b\d{1,3}\s*-?\s*(?:yo|y\/o|y\.o\.?|yom|yof)(?![a-z])/i]
];
const OLD = /\b\d{1,3}[\s-]*(?:years?|yrs?|months?|mos?|weeks?|wks?|days?)[\s-]*old\b/i;
const WHO = '(?:male|female|man|woman|gentleman|lady|boy|girl|baby|infant|newborn|preemie)', TIME = '(?!\\s*(?:min|mins|minutes|hours?|hrs?|days?|weeks?|months?|years?|shifts?|%))';
const PERSON = new RegExp('\\b' + WHO + '\\b', 'i');        // how a patient is spoken of without the word
// "The gentleman in bed 5", "the lady in 418": the person and the place side by side.
const PERSON_THERE = new RegExp('\\b' + WHO + '\\s+(?:in|at|from|on)\\s+(?:the\\s+)?(?:(?:room|rm|bed)\\s*#?\\s*\\d+[a-z]?|\\d{2,4}[a-z]?)\\b' + TIME, 'i');
// One patient, as against patients in general or the word used to describe something ("patient education").
const ONE = /\b(?:pt|patient)\b(?!(?:’s|'s)?\s+(?:education|safety|care|experience|satisfaction|surveys?|portal|population|loads?|ratios?|assignments?|handoffs?|hand-offs?|transport|flow|census|records?|information|info|details|privacy|identifiers?|rights|names?|handouts?|rooms?|beds?|lifts?|monitors?|week))/i;
const PLACE = /\b(?<!(?:conference|supply|break|meeting|class|training|sim|education|locker|storage|equipment|utility|mail|copy|tank|med|staff|board|waiting|family)\s)(?:room|rm|bed)\s*#?\s*\d+[a-z]?\b/i;
// "The lady in 412": a number after "in", unless it counts time.
const IN_NUMBER = /\bin\s+\d{1,4}[a-z]?\b(?!\s*(?:min|mins|minutes|hours?|hrs?|days?|weeks?|months?|years?|shifts?|%))/i;
// "Mr. Alvarez in 412": staff are rarely written of this way, patients usually are.
const TITLED = /\b(?:mr|mrs|ms)\b\.?\s+[a-z][a-z'’-]+(?:\s+[a-z][a-z'’-]+)?[^.!?\n]{0,30}?(?:\b(?:room|rm|bed)\s*#?\s*\d+[a-z]?\b|\bin\s+\d{1,4}[a-z]?\b(?!\s*(?:min|mins|minutes|hours?|hrs?|days?|weeks?|months?|years?|shifts?|%)))/i;
const NAMED = /\b(?:pt|patient)(?:’s|'s)?\s+(?:name\s*(?:is|was|:|=)|(?:is\s+|was\s+)?named)\s*([a-z][a-z'’-]*)/i;
const NOT_A_NAME = new Set('on in at the an and or not by to for is was required needed verified checked correct wrong misspelled spelled listed written printed always never above below here there'.split(' '));
// A long number is stopped only when nothing says what it is. A phone number, or an order, part or badge number, is not.
const LONG = /(?<![\d-])\d{7,12}(?![\d-])/g;
const PHONE = /^1?[2-9]\d{2}[2-9]\d{6}$/;
const LABELLED = /\b(?:pager|page|ext|extension|call|text|cell|phone|mobile|fax|dial|office|desk|line|hotline|helpdesk|order|po|p\.o\.|part|lot|serial|model|ref|reference|ticket|invoice|item|catalog|sku|tracking|asset|tag|badge|employee|pass|permit|license|code|confirmation)\b[^.!?\n]{0,30}$/i;
const PATIENT_CONTACT = /\b(?:pt|patient)(?:'s|’s)?\s+(?:(?:home|work|cell|mobile|contact|callback|phone|telephone|number)\s*)+(?:is\s*)?[:#=]?\s*(?:\+?1[ -]?)?\(?[2-9]\d{2}\)?[ .-]?[2-9]\d{2}[ .-]?\d{4}\b/i;
const ABOUT_A_RECORD = /\b(?:pt|patient|mrn|record|csn|dob|look\s?up)\b/i;
export const LONG_NUMBER_HELP = 'If the number is a phone, write it with dashes, like 317-555-0142. If it is an order, part or badge number, say which.';

const clip = words => { const flat = words.replace(/\s+/g, ' ').trim(); return flat.length > 44 ? flat.slice(0, 43) + '…' : flat; };

// What was found, each with the words that set it off: [{ sign, words }]. The words are for showing the person what to
// take out. They are never put in a receipt.
export function patientFindings(text) {
  const all = String(text || '').replace(/https?:\/\/\S+/gi, ' '), found = [], taken = [];
  const add = (sign, words, at = -1) => { if (!found.some(item => item.sign === sign)) found.push({ sign, words: clip(words) }); if (at >= 0) taken.push([at, at + words.length]); };
  for (const [sign, shape] of SHAPES) { const hit = shape.exec(all); if (hit) add(sign, hit[0], hit.index); }
  const titled = TITLED.exec(all);
  if (titled) add('a patient’s name', titled[0]);
  const contact = PATIENT_CONTACT.exec(all);
  if (contact) add('a patient’s contact number',contact[0],contact.index);
  for (const sentence of all.split(/[.!?]+(?=\s|$)|\n+/)) {
    const old = OLD.exec(sentence), named = NAMED.exec(sentence), one = ONE.exec(sentence), person = PERSON.exec(sentence), place = PLACE.exec(sentence) || IN_NUMBER.exec(sentence), there = PERSON_THERE.exec(sentence);
    // "My baby is 6 months old" is the writer's own family.
    if (old && (one || (person && !/\b(?:my|our)\b/i.test(sentence)))) add('a patient’s age', old[0]);
    // "named a different doctor" is not a name; "named A. Lopez" is
    if (named && !NOT_A_NAME.has(named[1].toLowerCase()) && !(named[1].toLowerCase() === 'a' && /^\s/.test(sentence.slice(named.index + named[0].length)))) add('a patient’s name', named[0]);
    if (one && place) add('a patient with a room or bed', sentence.slice(Math.min(one.index, place.index), Math.max(one.index + one[0].length, place.index + place[0].length)));
    else if (there) add('a patient with a room or bed', there[0]);
  }
  for (const hit of all.matchAll(LONG)) {
    if (taken.some(([from, to]) => hit.index >= from && hit.index < to)) continue;        // already named as a record or Social Security number
    const before = all.slice(Math.max(0, hit.index - 60), hit.index), line = before.split(/[.!?\n]/).at(-1) + all.slice(hit.index).split(/[.!?\n]/)[0];
    if (LABELLED.test(before) || (PHONE.test(hit[0]) && !ABOUT_A_RECORD.test(line))) continue;
    add('a long number with nothing to say what it is', hit[0]);
  }
  return found;
}
export const patientSigns = text => patientFindings(text).map(item => item.sign);
// The same list, with the words that set each one off, for the person looking at their own text.
export const patientShown = text => patientFindings(text).map(item => item.sign + ' (“' + item.words + '”)').join(', ');
