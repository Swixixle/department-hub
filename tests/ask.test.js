import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ask, findPeople, matchCorrection, matchTaught, parseWhen, readingProblem, searchDocuments } from '../src/ask.js';
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
  assert.match(reply('Is Morgan working this weekend?').title, /^Morgan has \d+ shifts? this weekend:$/);
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
  const result = ask('is maria on tonight', {...world, assignments:[row(today,'N','Marian'),row(today,'N','Marina')]});
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

test('trade questions are worked out with the trade rules, and answers offer a next step', async () => {
  const { projectRoster } = await import('../src/model.js');
  const trade = { roster: projectRoster(world.assignments, []), directory: world.directory, policy: (await import('../src/model.js')).POLICY, committed: [], today: world.today, offers: [] };
  const off = ask('who can take my next shift', { ...world, trade });
  assert.equal(off.kind, 'trade');
  assert.match(off.title, /^For .+: .+(keeps?|keeps everyone|hours).+\.$/);
  assert.ok(off.items.every(item => item.go.startsWith('options|')));
  assert.match(off.source, /does not know who is willing/);
  assert.equal(ask('i need friday off', { ...world, trade }).kind, 'trade');
  assert.equal(ask('whos workin tonite', { ...world, trade }).kind, 'who');                      // roster questions are untouched
  assert.equal(ask('what is the trade policy', { ...world, trade }).kind, 'look');               // a policy question is still a document search
  const up = ask('can i pick up saturday', { ...world, trade });
  assert.equal(up.kind, 'pickup');
  assert.match(up.title, /^(Picking up .+ (passes|does not pass)|You are already on|Nobody is listed)/);
  assert.equal(ask('who can take my next shift', world).kind === 'trade', false);                // without the trade rules it does not pretend
  assert.deepEqual(ask('When do I work next?', { ...world, trade }).next, ['Who am I working with on my next shift?', 'Who can I trade my next shift with?']);
  assert.match(ask('can someone cover my next shift', { ...world, trade }).title, /could cover it|cannot be offered|keeps? everyone|nothing left/);
});

test('ordinary schedule questions: which days, date ranges, days off and hours', () => {
  const when = text => { const found = parseWhen(text, today); return found && [found.from, found.to, found.shift, found.label]; };
  // "What days" asks which days. It is not a question about the day shift.
  assert.deepEqual(when('what days do i work the first week of december'), ['2026-12-01', '2026-12-07', null, 'from Dec 1 to Dec 7']);
  assert.deepEqual(when('what days do i work next week').slice(2), [null, 'next week']);
  assert.equal(when('who is on days friday')[2], 'D');
  assert.equal(when('do i work days or nights next week')[2], null);
  assert.deepEqual(when('my schedule for december'), ['2026-12-01', '2026-12-31', null, 'in December']);
  assert.deepEqual(when('my schedule next month').slice(0, 2), ['2026-12-01', '2026-12-31']);
  assert.deepEqual(when('do i work the 19th').slice(0, 2), ['2026-11-19', '2026-11-19']);
  assert.deepEqual(when('am i working on the 3rd').slice(0, 2), ['2026-12-03', '2026-12-03']);                 // the 3rd has passed, so the next one
  assert.deepEqual(when('shifts the week of nov 15').slice(0, 2), ['2026-11-15', '2026-11-21']);
  assert.deepEqual(when('when do i work in the next two weeks').slice(0, 2), ['2026-11-11', '2026-11-24']);
  assert.deepEqual(when('the rest of this week').slice(0, 2), ['2026-11-11', '2026-11-14']);
  assert.equal(when('may i ask something'), null);                                                              // "may" alone is not the month
  assert.deepEqual(when('fourth of july')[3], 'Independence Day, Sun, Jul 4, 2027');
  // The answers.
  // This roster ends in November. A week it does not cover is unknown, not a week without work.
  assert.equal(reply('What days do I work the first week of december?').title, 'No schedule entries are on record from Dec 1 to Dec 7.');
  const longer = { ...world, assignments: [...world.assignments, row('2026-12-02', 'N', world.actor), row('2026-12-05', 'D', 'Avery')] };
  assert.equal(ask('What days do I work the first week of december?', longer).title, 'You have 1 shift from Dec 1 to Dec 7:');
  assert.deepEqual(ask('whats my schedule for december', longer).lines, ['The schedule on record ends Sat, Dec 5. Later dates are not counted.']);
  assert.match(reply('what days do i work next week').title, /^You have (\d+|no) shifts? next week[:.]$/);
  assert.equal(reply('whats my schedule for december').title, 'No schedule entries are on record in December.');
  assert.match(reply('am i off friday').title, /^(Yes\. You are off Fri, Nov 13\.|No\. You work Fri, Nov 13:)$/);
  assert.match(reply('what days am i off next week').title, /^You are off \d recorded days? next week[:.]$/);
  assert.match(reply('when is my next day off').title, /^You are off \d+ recorded days? in the next 14 days[:.]$/);
  assert.equal(reply('how do i get time off').kind, 'look');                                                    // still a question for the documents
  const hours = ask('how many hours do i have this week', { ...world, trade: { policy: { weekStartsOn: 0, overtimeLimitMinutes: 2400 } } });
  assert.equal(hours.kind, 'hours');
  assert.match(hours.title, /^You are scheduled for [\d.]+ hours in the week of Sun, Nov 8\.$/);
  assert.match(hours.source, /The pay week starts on Sunday and the limit entered is 40 hours\./);
  // Someone who works only nights and asks about day shifts is told so, and still shown their schedule.
  const nightsOnly = { ...world, assignments: world.assignments.filter(item => item.shift === 'N' || item.person !== world.actor) };
  if (nightsOnly.assignments.some(item => item.person === world.actor && item.date >= today)) assert.match(ask('do i work days', nightsOnly).title, /^You have no day shifts from today on\.$/);
});

test('month-week dates respect explicit years and pay-week questions respect the configured boundary', () => {
  const december = parseWhen('the first week of December 2027', today);
  assert.deepEqual([december.from,december.to], ['2027-12-01','2027-12-07']);
  const trade = {policy:{weekStartsOn:1,overtimeLimitMinutes:2400}};
  const hours = ask('how many hours do I have next week', {...world,trade});
  assert.equal(hours.items.length, 1);
  assert.match(hours.title, /week of Mon, Nov 16/);
});

test('missing roster dates are unknown, rather than confirmed days off', () => {
  const absent = ask('am I off December 10', world);
  assert.equal(absent.empty, true);
  assert.doesNotMatch(absent.title, /^Yes/);
  assert.match(absent.source + absent.lines.join(' '), /missing|not on record/i);
  const empty = ask('what days am I off next week', {...world,assignments:[]});
  assert.equal(empty.empty, true);
  const mixed = {...world,assignments:[row('2026-11-13','D','Jordan'),row('2026-11-13','N','Morgan')]};
  assert.match(ask('am I off Friday night',mixed).title, /^Yes/);
  assert.equal(ask('am I off Friday night',{...mixed,assignments:mixed.assignments.slice(0,1)}).empty,true);
});

test('hours use agreed assignments and a trade follow-up uses the target week', async () => {
  const {assignmentKey,POLICY} = await import('../src/model.js');
  const dated = [row('2026-11-18','N','Jordan'),row('2026-11-20','N','Morgan')].map(item=>({...item,key:assignmentKey(item)}));
  const projected = dated.map(item=>item.person==='Morgan'?{...item,person:'Jordan'}:item);
  const trade = {roster:projected,directory:{},policy:POLICY,committed:[],today,offers:[]};
  assert.match(ask('how many hours do I have next week',{...world,assignments:dated,trade}).title, /24 hours/);
  const first = ask('who can trade my next shift',{...world,assignments:dated,trade:{...trade,roster:dated}});
  assert.equal(first.context.when.from,'2026-11-18');
  const next = ask('how many hours do I have that week',{...world,assignments:dated,trade:{...trade,roster:dated},last:first.context});
  assert.match(next.title, /week of Sun, Nov 15/);
});

// Questions found by typing thirty new ones against a real schedule after Version 12. Nine of the thirty were wrong.
test('a third round of ordinary questions: who is off, in a row, after, last, left, roles and holidays', () => {
  const earlier = { ...world, assignments: [...world.assignments, row('2026-11-06', 'N', 'Jordan', 'icu')] };
  const said = question => { const found = ask(question, earlier); return [found.kind, found.title, ...found.items.map(item => item.text)]; };
  // "Who is off" used to list who was on.
  assert.deepEqual(said('whos off tonite'), ['offlist', 'No shift listed tonight:', 'Wed, Nov 11: Avery, Blair, Jordan, Jordan K and Riley']);
  assert.deepEqual(said('who is not working friday').slice(0, 2), ['offlist', 'No shift listed Fri, Nov 13:']);
  assert.equal(said('is anyone off this weekend').length, 5);
  assert.match(ask('who is off tonight', earlier).source, /not the same as free or willing/);
  assert.equal(ask('am i off tonight', earlier).kind, 'off');                                          // the same keywords, a different question
  // "Do I have this weekend off" used to open trade options.
  const trade = { roster: earlier.assignments, directory: {}, policy: { weekStartsOn: 0, overtimeLimitMinutes: 2400, minimumRestMinutes: 480 }, committed: [], today, offers: [] };
  const traded = { ...earlier, trade };
  assert.deepEqual([ask('do i have this weekend off', traded).kind, ask('do i have this weekend off', traded).title], ['off', 'No. You work 3 shifts this weekend.']);
  assert.equal(ask('i need this weekend off', traded).kind, 'trade');
  assert.equal(ask('i cant work friday', traded).kind, 'trade');
  assert.equal(ask('is there anyone who could pick up friday', traded).kind, 'trade');                  // the asker works Friday, so this is cover for it
  assert.equal(ask('is there anyone who could pick up wednesday', traded).kind, 'offlist');             // and does not work Wednesday: who has no shift that day
  assert.match(ask('can Morgan cover my saturday', traded).items[0].text, /^Morgan taking it (passes|does not pass)/);
  assert.deepEqual([ask('how many days off do i have next week', traded).kind, ask('how do i get time off', traded).kind], ['off', 'look']);
  assert.match(ask('how long before the schedule do i ask for time off', traded).items[0].sub, /^Time off requests/);   // used to answer with the asker's next shift
  // Runs, the past, and what is left.
  assert.deepEqual(said('how many days in a row am i working'), ['run', 'Your longest stretch in the next four weeks is 3 in a row, Fri, Nov 13 to Sun, Nov 15.', 'Fri, Nov 13 to Sun, Nov 15', 'Thu, Nov 26']);
  assert.equal(said('when do i work again after friday')[1], 'Your next shift after Fri, Nov 13 is Sat, Nov 14, night.');
  assert.equal(said('when was my last shift')[1], 'Your last shift was Sun, Nov 8, night.');
  assert.equal(said('did i work last weekend')[1], 'You had 2 shifts last weekend:');
  assert.equal(said('how many shifts do i have left this month')[1], 'You have 4 shifts left this month:');
  assert.equal(said('how many weekends do i work in november')[1], 'You have 5 weekend shifts on 2 weekends in November:');
  assert.deepEqual(parseWhen('the weekend after next', today).from, '2026-11-27');
  assert.deepEqual(parseWhen('the day after thanksgiving', today).from, '2026-11-27');
  assert.deepEqual([parseWhen('last month', today).from, parseWhen('thanksgiving last year', today).from], ['2026-10-01', '2025-11-27']);
  // Roles and holidays.
  assert.deepEqual(said('who has charge friday night'), ['who', 'Marked charge:', 'Fri, Nov 13 night: Jordan']);
  assert.equal(said('am i charge this weekend')[1], 'You are marked charge on 1 of 3 shifts this weekend:');
  assert.equal(said('which holidays do i work')[1], 'You work the one holiday on this schedule, Thanksgiving.');
  assert.equal(said('do i work with morgan this week')[1], 'You and Morgan are on together 1 time this week:');
  assert.equal(said('am i on call this week')[1], 'On-call is not recorded here.');
});

// A further thirty unseen questions, run with no fixing first, got twenty-three right. Six of the seven misses:
test('a fourth round: my week, before a date, first and last, any week over the limit, weekend shifts left', () => {
  const earlier = { ...world, assignments: [...world.assignments, row('2026-11-06', 'N', 'Jordan', 'icu')], trade: { policy: { weekStartsOn: 0, overtimeLimitMinutes: 900 } } };
  const said = question => { const found = ask(question, earlier); return [found.kind, found.title]; };
  assert.deepEqual(said('whats my week look like'), ['when', 'You have 3 shifts this week:']);
  assert.deepEqual(said('what do i work before thanksgiving'), ['when', 'You have 3 shifts before Thanksgiving, Thu, Nov 26:']);
  assert.deepEqual(said('whats my last shift before thanksgiving'), ['when', 'Your last shift before Thanksgiving, Thu, Nov 26 is Sun, Nov 15, night.']);
  assert.deepEqual(said('whens my first shift this weekend'), ['when', 'Your first shift this weekend is Fri, Nov 13, night.']);
  assert.deepEqual(said('am i in the icu this week'), ['when', 'You are marked ICU on none of 3 shifts this week.']);
  assert.deepEqual(said('how many weekend shifts do i have left'), ['when', 'You have 3 weekend shifts on 1 weekend left on this schedule:']);
  assert.equal(ask('how many weekend shifts do i have left', earlier).understood, 'your weekend shifts, left on this schedule');
  assert.deepEqual(said('how many weekends have i worked').slice(0, 1), ['fair']);                              // the count against the share is still the fairness answer
  // Sunday night and three nights from Friday: 12 + 12 + 5 = 29 hours fall in the week of Nov 8 and 7 + 12 = 19 in the week of Nov 15, against a limit of 15. Thanksgiving week has 12.
  assert.deepEqual(said('am i over 15 hours any week'), ['hours', 'You are over the limit entered in 2 of the 3 weeks left on this schedule:']);
  assert.deepEqual(ask('am i over 15 hours any week', earlier).items.map(item => item.text), ['Week of Sun, Nov 8: 29 hours, 14 over the limit entered', 'Week of Sun, Nov 15: 19 hours, 4 over the limit entered']);
  assert.equal(parseWhen('the day before thanksgiving', today).from, '2026-11-25');
});

test('a date the schedule does not cover is unknown, and a range it partly covers says where it ends', () => {
  assert.equal(reply('what did i work last month').title, 'No schedule entries are on record for last month.');
  assert.equal(reply('who is on dec 20').title, 'No schedule entries are on record for Sun, Dec 20.');
  assert.equal(reply('do i work the day after thanksgiving').title, 'No schedule entries are on record for Fri, Nov 27.');
  assert.deepEqual(reply('how many shifts do i have left this month').lines, ['The schedule on record ends Thu, Nov 26. Later dates are not counted.']);
  assert.match(reply('did i work thanksgiving last year').lines[0], /^The schedule on record runs from Sun, Nov 8 to Thu, Nov 26\./);
});

test('every answer says in plain words what the question was taken to be', () => {
  const taken = question => ask(question, world).understood;
  assert.equal(taken('when do i work next'), 'when you work');
  assert.equal(taken('whos on nights friday'), 'who is on, Fri, Nov 13, nights');
  assert.equal(taken('who is off tonight'), 'who has no shift listed, tonight');
  assert.equal(taken('is anyone free friday'), 'who has no shift listed, Fri, Nov 13');
  assert.equal(taken('is Morgan working this weekend'), 'when Morgan works, this weekend');
  assert.equal(taken('how do i request leave'), 'a search of the documents and the board');
  assert.equal(taken('am i off friday'), 'days you are off, Fri, Nov 13');
});

test('a reviewed correction is worked out live, covers the same question about another person or day, and cannot add one', () => {
  // Department slang Ask reads the wrong way round: "on the bench" means off.
  const corrections = [{ id: 'c1', asks: ['Who is on the bench tonight?'], reads: 'who is off tonight', by: 'Jordan', at: '2026-11-11T12:00:00Z' },
    { id: 'c2', asks: ['is Morgan around friday'], reads: 'does Morgan work friday', by: 'Jordan', at: '2026-11-11T12:00:00Z' }];
  assert.equal(ask('who is on the bench tonight', world).kind, 'who');                                     // without it: who is on
  const fixed = ask('whos on the bench tonite', { ...world, corrections });                                // spelling is tidied before matching
  assert.deepEqual([fixed.kind, fixed.read, fixed.corrected.kind, fixed.corrected.id], ['offlist', 'who is off tonight', 'reading', 'c1']);
  assert.equal(fixed.items[0].text, 'Wed, Nov 11: Avery, Blair, Jordan, Jordan K and Riley');
  const later = ask('who is on the bench tonight', { ...world, corrections, assignments: [...world.assignments, row(today, 'N', 'Riley')] });
  assert.equal(later.items[0].text, 'Wed, Nov 11: Avery, Blair, Jordan and Jordan K');                       // the answer follows the schedule, not the day it was taught
  // The same question about another day or another person is read the same way, with that day or person.
  assert.deepEqual([ask('who is on the bench friday', { ...world, corrections }).read, ask('who is on the bench friday', { ...world, corrections }).kind], ['who is off friday', 'offlist']);
  const other = ask('is jordan k around saturday', { ...world, corrections });
  assert.deepEqual([other.read, other.corrected.id, other.understood], ['does jordan k work saturday', 'c2', 'when Jordan K works, Sat, Nov 14']);
  // A question that only shares the words is left alone.
  assert.equal(ask('am i on the bench tonight', { ...world, corrections }).corrected, undefined);
  assert.equal(ask('who is on the bench tonight and tomorrow', { ...world, corrections }).corrected, undefined);
  assert.equal(matchCorrection('who is on the bench tonight', corrections).correction.id, 'c1');
  assert.equal(readingProblem('who is on the bench tonight', 'who is off tonight', world), '');
  assert.match(readingProblem('when do i work', 'when does Morgan work', world), /cannot add a person or a date the question did not have: Morgan\./);
  assert.match(readingProblem('when do i work', 'do i work nov 26', world), /cannot add a person or a date/);
  assert.equal(readingProblem('who is on the bench tonight', 'Who is on the bench tonight?', world), 'That is the same wording.');
  assert.equal(readingProblem('who is on the bench tonight', 'where is the linen cart', world), 'Keep the same people and date scope in the rewording.');
  assert.equal(readingProblem('where is the cart','where is the linen cart',world),'Ask has no answer for that wording either.');
});

test('a passage the record keeper chose comes first for that question, and stops when the document changes', async () => {
  const offset = documents[0].text.indexOf('Holiday time off rotates'), version = await documentVersion(documents[0]);
  const corrections = [{ id: 'p1', asks: ['who decides christmas'], go: 'doc|leave|' + offset, sourceHash: version, by: 'Jordan', at: '2026-11-11T12:00:00Z' }];
  const before = ask('who decides christmas', { ...world, versions: { leave: version } });
  assert.notEqual(before.items[0]?.text.startsWith('Holiday time off rotates'), true);                     // read as a schedule question without the correction
  const fixed = ask('who decides christmas', { ...world, corrections, versions: { leave: version } });
  assert.deepEqual([fixed.kind, fixed.corrected.kind], ['look', 'passage']);
  assert.match(fixed.items[0].text, /^Holiday time off rotates each year\./);
  assert.match(fixed.items[0].sub, /chosen for this question by Jordan, as record keeper$/);
  const changed = ask('who decides christmas', { ...world, corrections, versions: { leave: 'another-version' } });
  assert.equal(changed.corrected, undefined);
  const numbered = [{ ...corrections[0], asks: ['what is rule 3'] }];
  assert.equal(ask('what is rule 3', { ...world, corrections: numbered, versions: { leave: version } }).corrected.kind, 'passage');
  assert.equal(ask('what is rule 4', { ...world, corrections: numbered, versions: { leave: version } }).corrected, undefined);   // a chosen passage is not carried to another number
});

test('reading corrections preserve the named people, relative dates and shift scope', () => {
  for (const [from,to] of [
    ['when do I work','do I work Friday'],
    ['is Morgan around Friday','when do I work Friday'],
    ['who is on the bench tonight','who is off tomorrow'],
    ['is Morgan around next Friday','does Morgan work Friday'],
    ['is Morgan around Friday','does Morgan work Friday night']
  ]) assert.notEqual(readingProblem(from,to,world),'',from+' -> '+to);
  const invalid = [{id:'bad',asks:['is Morgan around Friday'],reads:'when do I work Friday',by:'Jordan',at:'2026-11-11T12:00:00Z'}];
  assert.equal(ask('is Morgan around Friday',{...world,corrections:invalid}).corrected,undefined);
  const scoped=[{...invalid[0],reads:'does Morgan work Friday',people:['Morgan']}];
  assert.equal(ask('is Morgan around Friday',{...world,corrections:scoped,assignments:world.assignments.filter(row=>row.person!=='Morgan')}).corrected,undefined);
});

test('passage corrections do not override restricted fairness, invalid dates or ambiguous names', async () => {
  const version=await documentVersion(documents[0]), go='doc|leave|'+documents[0].text.indexOf('Holiday time off rotates');
  const corrections=['is it fair how many weekends Morgan has','do I work Feb 30','is maria on tonight'].map((q,i)=>({id:String(i),asks:[q],go,sourceHash:version,by:'Jordan',at:'2026-11-11T12:00:00Z'}));
  const w={...world,corrections,versions:{leave:version}};
  assert.match(ask(corrections[0].asks[0],w).title,/whoever keeps the record/);
  assert.match(ask(corrections[1].asks[0],w).title,/not a valid date/);
  assert.match(ask(corrections[2].asks[0],{...w,assignments:[row(today,'N','Marian'),row(today,'N','Marina')]}).title,/Which staff name/);
});

test('an incomplete weekend cannot establish that the entire weekend is off', () => {
  const partial=ask('do I have this weekend off',{...world,assignments:[row('2026-11-13','N','Morgan')]});
  assert.equal(partial.empty,true);
  assert.doesNotMatch(partial.title,/^Yes/);
  assert.match(partial.lines.join(' '),/missing/i);
});

test('who is off tonight filters the requested night shift and identifies missing shift data', () => {
  const w={...world,assignments:[row(today,'D','Avery'),row(today,'N','Morgan'),row('2026-11-13','N','Jordan')]};
  const result=ask('who is off tonight',w);
  assert.match(result.items[0].text,/Avery/);
  assert.doesNotMatch(result.items[0].text,/Morgan/);
  assert.match(result.items[0].sub,/night/);
  const absent=ask('who is off tonight',{...w,assignments:w.assignments.filter(item=>item.date!==today||item.shift!=='N')});
  assert.match(absent.items[0].text,/no schedule entries/i);
});

// Found on the merged Version 13: moving the invalid-date check ahead of document questions made a policy question
// with "24/7" in it answer "That is not a valid date". Any question with "24/7" already did.
test('a fraction such as 24/7 is not a date, and a date that cannot exist is still reported', () => {
  assert.equal(parseWhen('is the department staffed 24/7', today), null);
  assert.equal(parseWhen('split the weekend 50/50', today)?.label, 'this weekend');
  assert.equal(parseWhen('20/20 vision', today), null);
  assert.deepEqual([parseWhen('do i work 12/25', today).from, parseWhen('do i work 2/30', today).invalid, parseWhen('13/01', today).invalid, parseWhen('24/7/2027', today).invalid], ['2026-12-25', true, true, true]);
  const docs = [{ id: 'cover', title: 'Coverage', kind: 'Policy', effective: '2026-01-01', text: 'Staffing\n\nThe department is staffed 24/7 with four therapists on days and three on nights.' }];
  assert.match(ask('is the department staffed 24/7', { ...world, documents: docs }).items[0].text, /staffed 24\/7/);
  const policy = ask('what is the 24/7 coverage policy', { ...world, documents: docs });
  assert.deepEqual([policy.kind, /valid date/.test(policy.title)], ['look', false]);                        // a document search again, whatever it finds
  assert.match(reply('do i work 2/30').title, /not a valid date/);
});

// Measured on sixteen ordinary rewordings against a real schedule: the merged rule refused five, four of them only
// because the wording Ask reads best ends in "next".
test('a rewording may end in "next", and still may not add or drop a day, a span or a direction in time', () => {
  for (const [from, to] of [['when is Morgan back', 'when does Morgan work next'], ['when am i up', 'when do i work next'], ['what do i have coming', 'when do i work next']])
    assert.equal(readingProblem(from, to, world), '', from + ' -> ' + to);
  for (const [from, to] of [['is Morgan around next Friday', 'does Morgan work Friday'], ['is Morgan around Friday', 'does Morgan work next Friday'], ['whats on my plate', 'what do i work this week'],
    ['when am i up', 'when was my last shift'], ['when am i up', 'what did i work last week'], ['who is on the bench tonight', 'who was off last night']])
    assert.notEqual(readingProblem(from, to, world), '', from + ' -> ' + to);
  const corrections = [{ id: 'back', asks: ['when is Morgan back'], reads: 'when does Morgan work next', people: ['Morgan'], by: 'Jordan', at: '2026-11-11T12:00:00Z' }];
  const other = ask('when is parker back', { ...world, corrections });
  assert.deepEqual([other.read, other.kind, other.corrected.id], ['when does parker work next', 'when', 'back']);
});

test('a non-date slash expression does not hide an actual date later in the question', () => {
  const result=parseWhen('In our 24/7 department, do I work 12/25?',today);
  assert.equal(result?.from,'2026-12-25');
  assert.equal(parseWhen('The split is 50/50; do I work 2/30?',today)?.invalid,true);
});

test('joined dates disclose partial coverage without changing which date the existing lookup selects', () => {
  for (const [question, covered, from] of [
    ['Do I work Friday and Saturday?', 'Fri, Nov 13', '2026-11-13'],
    ['Do I work Saturday and Sunday?', 'Sun, Nov 15', '2026-11-15'],
    ['What days do I work this week and next week?', 'next week', '2026-11-15'],
    ['Who is working Friday & Saturday?', 'Fri, Nov 13', '2026-11-13'],
    ['Do I work Friday or Saturday?', 'Fri, Nov 13', '2026-11-13'],
    ['Do I work 11/13 and 11/14?', 'Fri, Nov 13', '2026-11-13']
  ]) {
    const result = reply(question);
    assert.match(result.partial, /^You asked about .+\. This answer covers only: /, question);
    assert.ok(result.partial.includes(result.understood), question);
    assert.ok(result.partial.includes(covered), question);
    assert.equal(result.context.when.from, from, question);
  }
});

test('the partial-date disclosure leaves ordinary conjunctions and short follow-ups alone', () => {
  for (const question of ['Do I work Friday?', 'Who is working days and nights Friday?', 'Are Morgan and Parker working Friday?',
    'Do I work Friday and Friday?', 'What days do I work this week and Friday?', 'What is the policy for holidays and weekends?', 'Who is working tonight?'])
    assert.equal(reply(question).partial, undefined, question);
  const first = reply('Who is working tonight?');
  const next = ask('and Friday?', { ...world, last: first.context });
  assert.equal(next.partial, undefined);
  assert.equal(next.context.when.shift, 'N');
});
