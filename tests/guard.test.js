import test from 'node:test';
import assert from 'node:assert/strict';
import { patientSigns } from '../src/guard.js';

test('ordinary department writing is not flagged', () => {
  for (const text of [
    'Staff meeting Thursday at 7 in conference room 2. Bring your badge.',
    'New filters are in the supply room. Call 555-0134 if we run out.',
    'CEU video on high-flow: https://vimeo.com/123456789',
    'Competencies are due by Nov 30. The policy is on the board.',
    'Who can cover my night on the 14th?',
    'Patient care week is next month, sign up for the potluck.'
  ]) assert.deepEqual(patientSigns(text), [], text);
});

test('the common shapes of patient information are flagged', () => {
  assert.deepEqual(patientSigns('72 yo on bipap, needs a recheck'), ['an age']);
  assert.deepEqual(patientSigns('MRN 4455667 is the one I meant'), ['a record or account number', 'a long number']);
  assert.deepEqual(patientSigns('DOB 3/4/1951'), ['a date of birth']);
  assert.deepEqual(patientSigns('pt in rm 412 pulled the trach again'), ['a patient with a room or bed']);
  assert.deepEqual(patientSigns('the patient named on the whiteboard'), ['a patient’s name']);
  assert.deepEqual(patientSigns('his number is 123-45-6789'), ['a Social Security number']);
  assert.deepEqual(patientSigns('look up 00123456789'), ['a long number']);
});
