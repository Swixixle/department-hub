import test from 'node:test';
import assert from 'node:assert/strict';
import { LONG_NUMBER_HELP, patientFindings, patientShown, patientSigns } from '../src/guard.js';

// Every line here is made up. ORDINARY is what a department writes to itself: contact details, teaching, equipment,
// scheduling. PATIENT is what must not be saved. The last third of each list was written after the rules were fixed,
// to measure them on text they were not shaped around.
const ORDINARY = [
  'Jordan’s new cell is 3175550142, text first.',
  'Call the vent rep at 18005550199 for the loaner.',
  'Night supervisor pager 5550117.',
  'Biomed ext 4471, after hours 317.555.0163.',
  'Fax the form to (317) 555-0148.',
  'Avery 3175550126 / Sam 3175550171 if you need a ride.',
  'My number changed: 3175550188',
  'Reach me at 317 555 0109 after 3.',
  'Use two identifiers before every treatment: name and date of birth.',
  'Never put a patient’s name or MRN in a text message.',
  'CEU Thursday at 2: ventilating the 3 month old with bronchiolitis.',
  'Reminder: no patient names, DOB or room numbers on this board.',
  'Skills fair covers neonatal resus, ages 0 to 28 days old.',
  'For patients over 65 years old, the protocol starts at 2 liters.',
  'Patient education class is in Room 204 on Friday.',
  'New hires: bring your Social Security card to HR on day one.',
  'The patient name band must be checked every time. Policy 4.2.',
  'In-service on patient handoff: who gets report, bed 1 through bed 12 walk-through.',
  'Case study night: a 70 year old with COPD, no real details, bring questions.',
  'The old Servo is 12 years old and goes out of service Friday.',
  'Order 4471902 for filters arrives Friday.',
  'Work order 1048812 is open for the broken BiPAP in the equipment room.',
  'Lot 20261104 of the neb kits is recalled. Pull them from supply room 3.',
  'Serial 0098127734 is the loaner vent.',
  'Tank room 2 is locked, the code changed.',
  'Staff meeting Thursday at 7 in conference room 2. Bring your badge.',
  'Who can cover my night on the 14th?',
  'My daughter turns 5 years old Saturday, need off the 21st.',
  'Potluck for Sam’s birthday 11/20, sign up on the board.',
  'I was born in Indiana, never worked a Christmas off in 9 years.',
  'Badge number 1048812 does not open the med room, who do I call?',
  'Patient care week is next month, sign up for the potluck.',
  'We had 14 patients on vents last night, 3 therapists. Need a fourth.',
  'Competencies are due by Nov 30. The policy is on the board.',
  'CEU video on high-flow: https://vimeo.com/123456789',
  'Account for every tank at shift change, 12 in the rack.',
  'Encounter forms are in the top drawer.',
  'Room 12 is the new break room.',
  'Parking pass 20261187 expires in December.',
  'Pts on high flow need hourly checks per the new protocol.',
  'The lady from biomed is coming to room 3 at noon.',
  'A man from the vendor will demo the new vent in room 2 on Tuesday.',
  'Our baby is 6 months old, I am not picking up extra nights.',
  'Scheduling office 5550142, leave a message.',
  'New cylinder vendor, account rep is Dana, 3175550155.',
  'Text me at 3175550133 if the BiPAP in the sleep lab acts up.',
  'Dr. Patel’s office line is 317-555-0190.',
  'Vent 7 has 41200 hours on it, PM is due.',
  'PFT lab moved to room 310.',
  'ABG machine QC failed at 0300, called biomed, ticket 55501234.',
  'Reminder: time-outs need two patient identifiers, see policy.',
  'If a patient is in isolation, gown up before you go in the room.',
  'Neo resus class: babies born before 32 weeks need the smaller mask.',
  'Peds refresher: a 2 year old’s airway is not a small adult’s.',
  'The new hire is 22 years old and already has her RRT, be nice.',
  'We go live with the new charting on 12/01/2026.',
  'Pulse ox probes: reorder #A20455, 12 left.',
  'Sign the attendance sheet, employee ID and date.',
  'Trach care video is 14 minutes, worth 0.25 CEU.',
  'Bed alarms on 4 West keep going off at night, facilities knows.',
  'Room 418 has the broken flowmeter, tagged it out.',
  'Patient rooms on 3 East get the new flowmeters first.',
  'Who took the transport vent from bed 12? Bring it back.',
  'Happy 30 years at the hospital to Sam!',
  'Census is 22, we are at 6 vents and 4 high flows.',
  'The patient lift in room 6 is out of order.',
  'PTO requests for the week of 12/21 are due Friday.',
  'Flu shot clinic: bring your badge, DOB not needed.',
  'Call light study: average response 4 min in room 10 through room 20.',
  'My kid is 6 months old, I am not picking up extra nights.',
  'The RT student is a 34 year old career changer, make him welcome.',
  'Oxygen order set 2291847 was updated in the system.',
  'Sam can be reached on 3175550164 all weekend.',
  'Lost and found: glasses left in the waiting room, at the desk now.',
  'Scheduling office 5550142, leave a message.',
  'New cylinder vendor, account rep is Dana, 3175550155.',
  'Charge phone tonight is 5550177.',
  'Sleep lab callback number 3175550111.',
  'Respiratory hotline: 18005550123',
  'Heads up, the Trilogy in the equipment room is 8 yrs old and due for replacement.',
  'Got a new number, 3175550119. Old one is dead.',
  'Can someone grab my shift 12/24? My son is 3 years old and it is his first real Christmas.',
  'PALS renewal is in classroom 2, bring your card.',
  'Annual fit testing: sign up by your birth month.',
  'Policy update: document the patient’s room air sat before every neb.',
  'If the patient is in a negative pressure room, use the HEPA filter.',
  'ICU beds 1 through 6 get the new vents first.',
  'Education day covers age-specific care: infant, child, adult, over 65.',
  'Sam’s work anniversary is 03/04, 15 years!',
  'HR needs your license number and expiration date by Friday.',
  'License 20455881 renews in June, do not forget your CEUs.',
  'Kronos is down. Write your hours on the sheet in the office.',
  'Whoever borrowed the IPV from room 9, it is due back.',
  'Vendor rep Dana Whitfield will be in room 2 at 1400 for the demo.',
  'The baby warmers in L&D have new blenders, in-service at 3.',
  'Question for days: who restocks the cart in bed tower B?',
  'My MRN lookup access is broken, who do I call?',
  'Do not write DOBs on the whiteboard. Initials only.',
  'There were 3 codes last night. Debrief Thursday.',
  'Mrs. Hall from infection control is rounding in 2 days, clean your carts.',
  'The patient portal is down until 0600.',
  'Text 317-555-0101 or 3175550101, either works.',
  'Tank delivery PO 4500012345 is delayed to Monday.',
  'Float pool: you are in 4 West tonight, not the ED.',
  'I am 41 years old and too tired for six in a row.',
  'Clinical ladder packets are due 1/15/2027.'
];
const PATIENT = [
  '72 yo on bipap, needs a recheck',
  'MRN 4455667 is the one I meant',
  'DOB 3/4/1951',
  'pt in rm 412 pulled the trach again',
  'his number is 123-45-6789',
  'the patient in room 12 needs a treatment at 0200',
  'Pt named Harold Finch is asking for the same therapist',
  'patient name: Maria Lopez, on 4 liters',
  'medical record number 00123456',
  'acct # 889123 needs a recheck on the charge',
  'date of birth 03/04/1951, same last name as the other one',
  '67 y/o male, COPD exacerbation, bed 4',
  'the 3 month old baby in PICU is still on high flow',
  'born on 3/4/1951, check the wristband',
  'FIN 778812345',
  'bed 9 pt is refusing nebs',
  'room 418 patient wants a different mask',
  'CSN: 100234567',
  'the 84 year old woman in 6 is a DNR',
  'SSN 123456789',
  'social security number is 123 45 6789',
  'look up 00123456789',
  '4455667 is the one I meant',
  'encounter number 5567123',
  'patient id 2291847',
  '45yo F with asthma, third admit this month',
  'D.O.B. Jan 4, 1951',
  'pt’s name is Robert, the one with the trach',
  'Mr. Alvarez in 412 wants his neb early',
  'the gentleman in bed 5 is 91',
  'Mr. Alvarez in 412 wants his neb early',
  'pt 67yo, bed 3, trach collar',
  'Patient: Dorothy Gale, MRN# 0045512',
  'DOB: 1951-03-04',
  'med rec # 5512098',
  'The patient in bed 2 is on 6L, family at bedside',
  'rm 7 pt has MRSA',
  'her social is 123-45-6789',
  'account number: 0099123',
  'born 03/04/1951',
  '89 y.o. female on comfort care',
  'that 5 day old infant in NICU 3 coded',
  'patient is named Eleanor',
  'chart # 77812',
  'The pt’s name was Walter, room 9',
  '2291847',
  'encounter 100299881',
  'visit number 4471',
  'pt id: A20455',
  'Bed 14’s patient needs suction q2',
  'the lady in 418, 92 years old, wants ice chips',
  'MR# 4455667',
  'pt DOB 3/4/51',
  'FIN# 3344556677',
  'trach pt on 4 West, 55 yr old male',
  'room 12 - new admit, 78yo, on bipap',
  'the gentleman in bed 5 is 91',
  'glasses left in room 7 by a patient’s family',
  'the trach pt in 418 needs a size 6',
  'Mrs. Hall in bed 3 keeps pulling her cannula',
  'pt name: J. Rivera',
  'MRN is 00812345',
  'D.O.B 3-4-51',
  'she is a 34 y/o asthmatic, frequent flyer',
  'new admit to room 22, patient is on 60% high flow',
  'the baby in 12 is 3 days old and on CPAP',
  'acct no. 5512',
  'look up 4455667 before you go in',
  'social security number: 123456789',
  'Medical Record # A0045512',
  'the patient named Harold wants the same therapist',
  'ms lopez in rm 9 is a hard stick',
  'bed 4 pt is 91 yo and DNR',
  'CSN 200113344, the ED hold',
  'pt in 7 is refusing treatment again',
  '78 year old male, hypoxic, on a non-rebreather',
  'Patient ID 9901234',
  'the man in room 15 fell last night',
  'born on 12/25/1940, family wants to be called first',
  'his birthdate is 3/4/1951',
  'encounter #88123',
  'that woman in 204 threw her neb at me',
  'pt Smith, room 6, needs ABG',
  '6 week old infant with RSV on high flow'
];

test('ordinary department writing is saved without a stop', () => {
  for (const text of ORDINARY) assert.deepEqual(patientSigns(text), [], text);
});

test('writing that points to a particular patient is stopped', () => {
  for (const text of PATIENT) assert.ok(patientSigns(text).length, text);
});

test('each stop says what it saw, with the words that set it off', () => {
  assert.deepEqual(patientFindings('MRN 4455667 is the one I meant'), [{ sign: 'a record or account number', words: 'MRN 4455667' }]);
  assert.deepEqual(patientSigns('72 yo on bipap, needs a recheck'), ['a patient’s age']);
  assert.deepEqual(patientSigns('DOB 3/4/1951'), ['a date of birth']);
  assert.deepEqual(patientSigns('pt in rm 412 pulled the trach again'), ['a patient with a room or bed']);
  assert.deepEqual(patientSigns('his number is 123-45-6789'), ['a Social Security number']);
  assert.deepEqual(patientSigns('Pt named Harold Finch is asking for the same therapist'), ['a patient’s name']);
  assert.equal(patientShown('look up 00123456789'), 'a long number with nothing to say what it is (“00123456789”)');
  assert.match(LONG_NUMBER_HELP, /317-555-0142/);
});

test('a word on its own is not a sign; the value is', () => {
  assert.deepEqual(patientSigns('Use two identifiers: name and date of birth.'), []);
  assert.deepEqual(patientSigns('date of birth 03/04/1951'), ['a date of birth']);
  assert.deepEqual(patientSigns('Bring your Social Security card to HR.'), []);
  assert.deepEqual(patientSigns('SSN 123456789'), ['a Social Security number']);
  assert.deepEqual(patientSigns('The old Servo is 12 years old.'), []);
  assert.deepEqual(patientSigns('the 84 year old woman in 6 is a DNR').includes('a patient’s age'), true);
  assert.deepEqual(patientSigns('Patient education class is in Room 204 on Friday.'), []);
  assert.deepEqual(patientSigns('the patient in room 12 needs a treatment at 0200'), ['a patient with a room or bed']);
});

test('a phone number or a labelled number is not a patient number', () => {
  assert.deepEqual(patientSigns('Jordan’s new cell is 3175550142, text first.'), []);
  assert.deepEqual(patientSigns('Order 4471902 for filters arrives Friday.'), []);
  assert.deepEqual(patientSigns('4455667 is the one I meant'), ['a long number with nothing to say what it is']);
  assert.deepEqual(patientSigns('pt callback 3175550142'), ['a long number with nothing to say what it is']);
});

// What the screen is known to get wrong. Kept here so the limits are written down and a later change that fixes one
// shows up as a failing test to be moved.
test('known limits', () => {
  assert.ok(patientSigns('My account got locked again, IT number is 5550100.').length, 'a seven-digit number after the bare word "number" is still stopped; dashes get it through');
  assert.deepEqual(patientSigns('My account got locked again, IT number is 555-0100.'), []);
  assert.deepEqual(patientSigns('Jane Doe 03/04/1951'), [], 'a name and a date with no label is not caught');
  assert.deepEqual(patientSigns('the 70 year old with COPD in the ER is crashing'), [], 'an age with no patient word and no room is not caught');
});
