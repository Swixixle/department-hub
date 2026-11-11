import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ask, findPeople, matchTaught, parseWhen, searchDocuments } from '../src/ask.js';
import { documentVersion } from '../src/audit.js';

const row = (date, shift, person, role) => ({ date, shift, person, ...(role ? { role } : {}) });
const today = '2026-11-11';                       // a Wednesday
const assignments = [
  row('2026-11-11', 'D', 'Avery'), row('2026-11-11', 'D', 'Blair'), row('2026-11-11', 'N', 'Morgan', 'charge'), row('2026-11-11', 'N', 'Parker'), row('2026-11-11', 'N', 'Quinn', 'icu'),
  row('2026-11-13', 'N', 'Jordan', 'charge'), row('2026-11-13', 'N', 'Morgan', 'icu'), row('2026-11-13', 'N', 'Parker'), row('2026-11-13', 'N', 'Quinn'),
  row('2026-11-14', 'N', 'Jordan'), row('2026-11-14', 'N', 'Riley'), row('2026-11-15', 'N', 'Jordan'), row('2026-11-18', 'N', 'Jordan K'), row('2026-11-26', 'N', 'Jordan'), row('2026-11-08', 'N', 'Jordan')
];
const posts = [
  { id: 'a', author: 'Avery', body: 'New filters are in the supply room.', created: '2026-11-09T10:00:00Z' },
  { id: 'b', author: 'Blair', body: 'Skills fair sign-up closes.', created: '2026-11-10T10:00:00Z', when: { kind: 'due', date: '2026-11-12' } },
  { id: 'c', author: 'Avery', body: 'Staff meeting in the conference room.', created: '2026-11-10T12:00:00Z', when: { kind: 'meeting', date: '2026-11-20' } },
  { id: 'd', author: 'Jordan', body: 'My own post.', created: '2026-11-10T13:00:00Z' }
];
const documents = [{ id: 'leave', title: 'Time off requests', kind: 'Policy', effective: '2026-01-01',
  text: 'Purpose\n\nThis document describes how staff ask for time off.\n\nRequesting leave\n\nA request for leave is entered at least four weeks before the schedule is posted. The lead approves requests in the order they arrive.\n\nHolidays\n\nHoliday time off rotates each year.' }];
const world = { today, actor: 'Jordan', assignments, posts, documents, directory: {}, people: [{ id: 'lane,avery', first: 'Avery', last: 'Lane', cell: '3175550100' }], links: { avery: 'lane,avery' }, releases: [], requests: [], rules: {}, keeper: false, seen: '2026-11-09T12:00:00Z', published: '2026-11-08T09:00:00Z' };
const reply = question => ask(question, world);

test('a question names its day: today, tonight, weekdays, weekends, dates and holidays', () => {
  const when = text => { const found = parseWhen(text, today); return found && [found.from, found.to, found.shift]; };
  assert.deepEqual(when('who is on tonight'), [today, today, 'N']);
  assert.deepEqual(when('am I working tomorrow'), ['2026-11-12', '2026-11-12', null]);
  assert.deepEqual(when('friday night'), ['2026-11-13', '2026-11-13', 'N']);
  assert.deepEqual(when('who works wednesday'), [today, today, null]);
  assert.deepEqual(when('next wednesday'), ['2026-11-18', '2026-11-18', null]);
  assert.deepEqual(when('this weekend'), ['2026-11-13', '2026-11-15', null]);
  assert.deepEqual(when('next week days'), ['2026-11-15', '2026-11-21', 'D']);
  assert.deepEqual(when('on nov 26'), ['2026-11-26', '2026-11-26', null]);
  assert.deepEqual(when('12/25'), ['2026-12-25', '2026-12-25', null]);
  assert.deepEqual(when('jan 3'), ['2027-01-03', '2027-01-03', null]);
  assert.deepEqual(when('Thanksgiving'), ['2026-11-26', '2026-11-26', null]);
  assert.deepEqual(when("who works Christmas eve night"), ['2026-12-24', '2026-12-24', 'N']);
  assert.equal(when('how do I request leave'), null);
  assert.deepEqual(findPeople('is jordan k on with Morgan?', ['Jordan', 'Jordan K', 'Morgan', 'Mo']), ['Jordan K', 'Morgan']);
});

test('schedule questions are answered from the roster and say so', () => {
  assert.match(reply('When do I work next?').title, /^Your next shift is Fri, Nov 13, night \(charge\)\.$/);
  assert.deepEqual(reply('When do I work next?').items.map(item => item.text.slice(0, 11)), ['Fri, Nov 13,', 'Sat, Nov 14,', 'Sun, Nov 15,', 'Thu, Nov 26,'].map(text => text.slice(0, 11)));
  assert.equal(reply('Who am I working with on my next shift?').items[0].text, 'Fri, Nov 13 night: with Morgan (ICU), Parker and Quinn');
  assert.deepEqual(reply('Who is on tonight?').items.map(item => item.text), ['Wed, Nov 11 night: Morgan (charge), Parker and Quinn (ICU)']);
  assert.deepEqual(reply('who is on today').items.length, 2);
  assert.match(reply('Is Morgan working this weekend?').title, /^Morgan is on this weekend:$/);
  assert.match(reply('Am I working Thanksgiving?').title, /^You are on Thanksgiving, Thu, Nov 26:$/);
  assert.match(reply('am i working tomorrow').title, /^You are not on the schedule tomorrow\.$/);
  assert.match(reply('when does Jordan K work').title, /^Jordan K’s next shift is Wed, Nov 18, night\.$/);
  assert.match(reply('When do I work next?').source, /^The schedule, published Sun, Nov 8$/);
  assert.equal(reply('Who is on tonight?').items[0].go, 'date|2026-11-11');
});

test('the board, dated posts, contacts and the person’s own sheet', () => {
  const news = reply('What did I miss on the board?');
  assert.match(news.title, /^2 new on the board since you last looked$/);          // not the old post, and not my own
  assert.deepEqual(news.items.map(item => item.go), ['post|c', 'post|b']);
  assert.match(news.source, /not policy/);
  assert.deepEqual(reply('What is coming up?').items.map(item => item.text.slice(0, 20)), ['Due Thu, Nov 12: Ski', 'Meeting Fri, Nov 20:']);
  assert.deepEqual(reply('when is the next meeting').items.map(item => item.go), ['post|c']);
  assert.match(reply('What is due before my next shift?').title, /^Due before your next shift on Fri, Nov 13$/);
  assert.deepEqual(reply('What is due before my next shift?').items.length, 1);
  assert.equal(reply("What is Avery's number?").items[0].text, 'Avery: 317.555.0100');
  assert.match(reply('How many weekends have I worked?').title, /^On this schedule, you have 4 weekend turns in 5 shifts\./);
  // Someone else's numbers are not given out, unless the person asking keeps the record.
  assert.match(reply('how many weekends has Morgan worked? is it fair').title, /whoever keeps the record/);
  assert.match(ask('is it fair how many weekends Morgan has', { ...world, keeper: true }).title, /^On this schedule, Morgan has/);
});

test('staffing off the usual number is listed with its dates', () => {
  const nights = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'].flatMap(date => ['Morgan', 'Parker', 'Quinn'].map(person => row(date, 'N', person)));
  const roster = [...nights, ...['Jordan', 'Morgan', 'Parker', 'Quinn'].map(person => row('2026-11-13', 'N', person)), row('2026-11-14', 'N', 'Jordan'), row('2026-11-14', 'N', 'Riley')];
  const found = ask('any short nights this week or four people?', { ...world, assignments: roster });
  assert.deepEqual(found.items.map(item => item.text), ['Fri, Nov 13 night: 4 listed, usual is 3', 'Sat, Nov 14 night: 2 listed, usual is 3']);
  assert.match(ask('any short shifts tomorrow', { ...world, assignments: roster }).title, /^No listed shifts differ from their usual headcount, tomorrow$/);
});

test('documents are quoted with their title, section and date, and an unanswered question says so', () => {
  const found = reply('How do I request leave?');
  assert.equal(found.items[0].go.split('|').slice(0, 2).join('|'), 'doc|leave');
  assert.match(found.items[0].text, /^A request for leave is entered at least four weeks/);
  assert.equal(found.items[0].sub, 'Time off requests · Requesting leave · Policy · effective 2026-01-01');
  assert.match(found.source, /Quoted from the document as added/);
  assert.equal(documents[0].text.slice(Number(found.items[0].go.split('|')[2])).startsWith('A request for leave'), true);
  // The board is searched too, and labelled for what it is.
  assert.match(reply('where are the new filters').items[0].sub, /A post on the board by Avery, not policy/);
  const none = reply('what is the ventilator weaning protocol');
  assert.equal(none.empty, true);
  assert.match(none.title, /Nothing on record answers that/);
  assert.match(ask('anything on weaning', { ...world, documents: [] }).source, /No documents have been added yet/);
  assert.deepEqual(searchDocuments('the and for', documents), []);
  assert.match(reply('Who approves leave?').items[0].go, /^doc\|leave\|/);
});

test('the next shift itself can be opened, even when it is the only future shift', () => {
  const answer = ask('When do I work next?', { ...world, assignments:[row('2026-11-13', 'N', 'Jordan')] });
  assert.equal(answer.items[0]?.go, 'date|2026-11-13');
});

test('date lookups respect explicit years, reject impossible dates and retain unchecked holidays', () => {
  assert.equal(parseWhen('Nov 26, 2027', today).from, '2027-11-26');
  assert.equal(parseWhen('11/26/2027', today).from, '2027-11-26');
  assert.equal(parseWhen('2027-11-26', today).from, '2027-11-26');
  assert.equal(parseWhen('Feb 30', today).invalid, true);
  assert.equal(parseWhen('13/01', today).invalid, true);
  assert.equal(parseWhen('Christmas', today, { off:['Christmas Day'] }).from, '2026-12-25');
  assert.equal(parseWhen('Christmas 2027', today, { off:['Christmas Day'] }).from, '2027-12-25');
  const future = ask('Am I working Nov 26, 2027?', { ...world, assignments:[...assignments, row('2027-11-26', 'N', 'Jordan')] });
  assert.deepEqual(future.items.map(item => item.go), ['date|2027-11-26']);
  assert.equal(reply('Am I working Feb 30?').empty, true);
  assert.match(reply('Am I working Feb 30?').title, /valid date/);
});

test('policy and protocol questions search documents before schedule or board keywords', () => {
  const docs = [{ id:'leave-rule', title:'Leave policy', kind:'Policy', effective:'2026-01-01',
    text:'Leave requests are due four weeks before publication. The lead records each request and reviews staffing before approving leave.' }];
  const answer = ask('What is the leave policy deadline?', { ...world, documents:docs });
  assert.equal(answer.items[0]?.go.split('|').slice(0, 2).join('|'), 'doc|leave-rule');
  assert.match(answer.items[0].sub, /Policy/);
});

test('missing dates or shifts cannot establish that staffing is normal', () => {
  for (const rows of [[], assignments.filter(item => item.shift === 'D'), assignments.filter(item => item.date !== today)]) {
    const answer = ask('Any short nights tonight?', { ...world, assignments:rows });
    assert.equal(answer.empty, true);
    assert.doesNotMatch(answer.title, /Every shift has its usual number/);
  }
});

test('fairness describes scheduled turns without claiming that future shifts were worked', () => {
  const answer = reply('How many weekends have I worked?');
  assert.doesNotMatch(answer.title, /have worked/);
  assert.match(answer.title, /schedule/);
});

test('next-shift lookups skip shifts that already started when the current time is available', () => {
  const rows = [row(today, 'D', 'Jordan'), row(today, 'N', 'Jordan'), row('2026-11-12', 'N', 'Jordan'), row('2026-11-12', 'N', 'Morgan')];
  const current = { ...world, assignments:rows, now:'2026-11-11T21:00:00-05:00' };
  assert.equal(ask('When do I work next?', current).items[0].go, 'date|2026-11-12');
  assert.match(ask('Who am I working with on my next shift?', current).items[0].text, /^Thu, Nov 12 night: with Morgan$/);
  assert.equal(ask('When do I work next?', { ...current, now:'2026-11-11T17:00:00-05:00' }).items[0].go, 'date|2026-11-11');
});

test('matching a sample announcement without a timestamp still opens its source', () => {
  const answer = ask('How can I start a trade?', { ...world, posts:[{ id:'sample', author:'Avery', created:null, body:'Start a trade from the schedule.' }], documents:[] });
  assert.equal(answer.items[0].go, 'post|sample');
  assert.match(answer.source, /not policy/);
});

test('messy questions are read: shorthand, misspellings, bad grammar and follow-ups', () => {
  assert.match(reply('wen do i work nxt').title, /^Your next shift is Fri, Nov 13, night \(charge\)\.$/);
  assert.match(reply('me working thanksgivng??').title, /^You are on Thanksgiving, Thu, Nov 26:$/);
  assert.equal(reply('who am i w/ fri nite').items[0].text, 'Fri, Nov 13 night: with Morgan (ICU), Parker and Quinn');
  assert.deepEqual(reply('whos on 2nite').items.map(item => item.text), ['Wed, Nov 11 night: Morgan (charge), Parker and Quinn (ICU)']);
  const fixed = reply('is Morgn workin firday');
  assert.match(fixed.title, /^Morgan is on Fri, Nov 13:$/);
  assert.equal(fixed.read, 'is morgan working friday');
  assert.deepEqual(fixed.changes, [['morgn', 'morgan'], ['firday', 'friday']]);
  assert.equal(reply('When do I work next?').read, '');
  // Shorthand is spelled out and shown back, and a shift named without a day does not mean today only.
  assert.equal(reply('whos workin tonite').read, 'who is working tonight');
  assert.equal(reply('any short nites this wk').context.when.label, 'this week');
  assert.match(reply('any short nights').title, /the next four weeks$/);
  assert.equal(reply('wen r the competencies do').read, 'when are the competencies due');
  assert.equal(reply('wen r the competencies do').kind, 'dated');
  // A follow-up keeps the kind of question and changes the part that was named.
  const first = reply('who is on tonight');
  const then = ask('and friday?', { ...world, last: first.context });
  assert.deepEqual(then.items.map(item => item.text.slice(0, 17)), ['Fri, Nov 13 night']);
  const person = ask('what about Morgan', { ...world, last: reply('when do I work next').context });
  assert.match(person.title, /^Morgan’s next shift is Wed, Nov 11, night \(charge\)\.$/);
});

test('documents are found through other words for the same thing, misspellings and word endings', () => {
  for (const question of ['how do i get pto', 'requesting vacation', 'how to reqest leav', 'time off requests how', 'what are the rules for asking for days off'])
    assert.match(reply(question).items[0]?.sub || '', /^Time off requests/, question);
  assert.match(reply('How do I request leave?').items[0].text, /^A request for leave is entered/);
  assert.equal(reply('ventilator weaning steps').empty, true);
});

test('a taught note is labelled and relevance feedback is bound to the source version', async () => {
  const answers = [{ id: 't1', asks: ['where do the dirty circuits go'], answer: 'The grey bin in the soiled utility room.', by: 'Avery', at: '2026-11-10T09:00:00Z', source: 'Lead, Nov 10' }];
  const taught = ask('where do dirty circuts go?', { ...world, answers });
  assert.equal(taught.items[0].text, 'The grey bin in the soiled utility room.');
  assert.equal(taught.items[0].sub, 'Recorded as Avery on Tue, Nov 10 · Lead, Nov 10');
  assert.match(taught.title, /not official policy/);
  assert.equal(taught.taught, 't1');
  assert.equal(ask('where is the supply room', { ...world, answers }).taught, undefined);
  // A question that would be read as another kind still gets the answer taught for those exact words, misspelled or not.
  const due = [{ id: 't2', asks: ['when is the skills fair due'], answer: 'It is not due. The skills fair is walk-in, any Tuesday.', by: 'Avery', at: '2026-11-10T09:00:00Z', source: '' }];
  assert.equal(ask('when is the skills fair due', { ...world }).kind, 'dated');
  assert.equal(ask('is my schedule fair', { ...world }).kind, 'fair');
  assert.equal(ask('wen is the skills fair due?', { ...world, answers: due }).taught, undefined);
  assert.equal(ask('what is due this week', { ...world, answers: due }).taught, undefined);
  const text = 'Holidays\n\nHoliday time off rotates each year between staff.\n\nRequests\n\nA holiday request is entered in the fall for the year ahead.';
  const docs = [{ id: 'h', title: 'Holidays', kind: 'Policy', effective: '', text }];
  const before = ask('holiday time off rule', { ...world, documents: docs }).items[0].go;
  const wanted = 'doc|h|' + text.indexOf('A holiday request');
  assert.notEqual(before, wanted);
  const version = await documentVersion(docs[0]);
  const learned = [{ terms:['holiday', 'time', 'off', 'rule'], go:wanted, count:3, sourceHash:version, qualifiers:'' }];
  assert.equal(ask('holiday time off rule', { ...world, documents:docs, versions:{h:version}, learned }).items[0].go, wanted);
  assert.equal(ask('holiday time off rule', { ...world, documents:docs, versions:{h:'changed'}, learned }).items[0].go, before);
  assert.equal(ask('holiday time off rule', { ...world, documents:docs, learned }).items[0].go, before);
});

test('taught wording cannot override live records or another person’s fairness restriction', () => {
  const note = q => ({ id:'x', asks:[q], answer:'This answer must not override the live lookup.', by:'Jordan', at:'2026-11-10', source:'' });
  assert.match(ask('When do I work next?', { ...world, answers:[note('When do I work next?')] }).title, /^Your next shift/);
  const q = 'how many weekends has Morgan worked';
  assert.match(ask(q, { ...world, keeper:false, answers:[note(q)] }).title, /whoever keeps the record/);
});

test('changed, missing, withdrawn and future sources cannot validate taught explanations', async () => {
  const doc = documents[0], version = await documentVersion(doc), q = 'where do dirty circuits go';
  const note = { id:'bound', asks:[q], answer:'Bound explanation', documentId:doc.id, sourceHash:version, by:'Jordan', at:today };
  const base = { ...world, answers:[note], versions:{[doc.id]:version} };
  assert.equal(ask(q, base).taught, 'bound');
  for (const change of [{documents:[]}, {versions:{[doc.id]:'changed'}}, {documents:[{...doc,status:'withdrawn'}]}, {documents:[{...doc,effective:'2027-01-01'}]}])
    assert.equal(ask(q, {...base,...change}).taught, undefined);
});

test('learning keeps negation and obligation separate and ambiguous names need clarification', () => {
  const note = { id:'n', asks:['can we reuse circuits'], answer:'Only a note.' };
  assert.equal(matchTaught('cannot we reuse circuits', [note]), null);
  assert.equal(matchTaught('must we reuse circuits', [note]), null);
  const result = ask('is kesha on tonight', {...world, assignments:[row(today,'N','Keshia'),row(today,'N','Keisha')]});
  assert.equal(result.empty, true);
  assert.match(result.title, /Which staff name/);
  assert.equal(result.items.length, 0);
});

test('follow-ups retain the night pool but a fresh question resets coworker context', () => {
  const first = reply('who is on tonight');
  const next = ask('and friday?', {...world,last:first.context});
  assert.equal(next.context.when.shift, 'N');
  const withMe = reply('who am I working with on my next shift');
  const fresh = ask('who is on tonight', {...world,last:withMe.context});
  assert.match(fresh.items[0].text, /Morgan \(charge\), Parker and Quinn/);
});
