// Signs that a piece of writing may point to a patient. This is a screen, not a guarantee: it knows the common shapes
// (a record number, an age, a birth date, a patient with a room) and misses anything written another way. It never
// sends the words anywhere. Links are left out, because a video address is often a long number.
const SIGNS = [
  ['a record or account number', /\b(mrn|m\.r\.n\.?|medical record|fin|acct|account|encounter|csn)\b\s*(number|no\.?|num)?\s*[:#]?\s*\d/i],
  ['a date of birth', /\b(dob|d\.o\.b\.?|date of birth)\b|\bborn\s+(on\s+|in\s+)?\d/i],
  ['a Social Security number', /\b(ssn|social security)\b|\b\d{3}-\d{2}-\d{4}\b/i],
  ['an age', /\b\d{1,3}\s*-?\s*(yo|y\/o|y\.o\.?|yrs?\s+old|years?\s+old|year-old|months?\s+old|month-old|mo\s+old)\b/i],
  ['a long number', /(?<![\d-])\d{7,12}(?![\d-])/],
  ['a patient’s name', /\b(pt|patient)(’s|'s)?\s+(name|named)\b/i]
];
const PATIENT = /\b(pt|pts|patient|patients)\b/i, PLACE = /\b(room|rm|bed)\s*#?\s*\d+[a-z]?\b/i;

export function patientSigns(text) {
  const words = String(text || '').replace(/https?:\/\/\S+/gi, ' ');
  const found = SIGNS.filter(([, shape]) => shape.test(words)).map(([label]) => label);
  if (PATIENT.test(words) && PLACE.test(words)) found.push('a patient with a room or bed');
  return found;
}
