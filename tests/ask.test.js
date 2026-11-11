import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ask, findPeople, parseWhen, searchDocuments } from '../src/ask.js';

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
  assert.deepEqual(reply('When do I work next?').items.map(item => item.text.slice(0, 11)), ['Sat, Nov 14,', 'Sun, Nov 15,', 'Thu, Nov 26,'].map(text => text.slice(0, 11)));
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
  assert.match(reply('How many weekends have I worked?').title, /^You have worked 4 weekend turns in 5 shifts\./);
  // Someone else's numbers are not given out, unless the person asking keeps the record.
  assert.match(reply('how many weekends has Morgan worked? is it fair').title, /whoever keeps the record/);
  assert.match(ask('is it fair how many weekends Morgan has', { ...world, keeper: true }).title, /^Morgan has worked/);
});

test('staffing off the usual number is listed with its dates', () => {
  const nights = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'].flatMap(date => ['Morgan', 'Parker', 'Quinn'].map(person => row(date, 'N', person)));
  const roster = [...nights, ...['Jordan', 'Morgan', 'Parker', 'Quinn'].map(person => row('2026-11-13', 'N', person)), row('2026-11-14', 'N', 'Jordan'), row('2026-11-14', 'N', 'Riley')];
  const found = ask('any short nights this week or four people?', { ...world, assignments: roster });
  assert.deepEqual(found.items.map(item => item.text), ['Fri, Nov 13 night: 4 listed, usual is 3', 'Sat, Nov 14 night: 2 listed, usual is 3']);
  assert.match(ask('any short shifts tomorrow', { ...world, assignments: roster }).title, /^Every shift has its usual number, tomorrow$/);
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
});
