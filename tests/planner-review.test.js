import test from 'node:test';
import assert from 'node:assert/strict';
import { ask } from '../src/ask.js';
import { world } from './eval/world.mjs';

test('per-person counts require the custodian just like rankings, including follow-ups',()=>{
  const q='How many weekend shifts has each person worked?';
  const permitted=ask(q,world);
  assert.equal(permitted.kind,'count');
  assert.ok(permitted.items.some(item=>item.text==='Avery: 6 weekend shifts'));
  for(const last of [null,permitted.context]) {
    const result=ask(last?'Same thing for nights':q,{...world,keeper:false,last});
    assert.match(result.title,/kept by whoever keeps the record/);
    assert.deepEqual(result.items,[]);
    assert.match(result.understood,/weekend shifts/);
  }
});

test('an explicit weekday remains part of a weekend ranking',()=>{
  const result=ask('Who has the most weekend shifts on Friday night?',world);
  assert.equal(result.context.plan.when.from,'2026-11-13');
  assert.equal(result.context.plan.when.to,'2026-11-13');
  assert.match(result.understood,/Fri, Nov 13/);
  assert.equal(result.items[0].text,'Morgan: 1 weekend shift');
});

test('a numeric ranking limit is not a date or an implicit this-weekend filter',()=>{
  const result=ask('Who has the top 3 weekend day shift counts?',world);
  assert.equal(result.context.plan.limit,3);
  assert.equal(result.context.plan.when,null);
  assert.equal(result.items[0].text,'Avery: 6 weekend shifts');
});

test('a fresh comparison can include both day and night shifts',()=>{
  for(const q of ['Who has the most weekend shifts on days and nights?',
    'Who has the most weekend shifts on day shift and night shift?']) {
    const result=ask(q,world);
    assert.equal(result.context.plan.shift,null,q);
    assert.doesNotMatch(result.understood,/on night shift|on day shift/);
    assert.equal(result.items[0].text,'Morgan: 7 weekend shifts');
    assert.ok(result.items.some(item=>item.text==='Avery: 6 weekend shifts'));
  }
});

test('ranking within named people cannot name somebody outside the requested group',()=>{
  const result=ask('Which of Blair and Casey has the most weekend day shifts?',world);
  assert.deepEqual(result.context.plan.people,['Blair','Casey']);
  assert.match(result.understood,/among Blair and Casey/);
  assert.equal(result.items[0].text,'Blair: 5 weekend shifts');
  assert.ok(result.items.every(item=>/^(Blair|Casey):/.test(item.text)));
});

test('a fewer comparison selects the lower total',()=>{
  const result=ask('Who has fewer weekend day shifts, Blair or Casey?',world);
  assert.equal(result.context.plan.direction,'lowest');
  assert.equal(result.items[0].text,'Casey: 4 weekend shifts');
  assert.match(result.title,/Casey has fewer/);
});

test('a new roster question drops the old ranking plan from conversation context',()=>{
  const ranked=ask('Who has the most weekend day shifts?',world);
  const roster=ask('Who is on tonight?',{...world,last:ranked.context});
  assert.equal(roster.kind,'who');
  assert.equal(roster.context.plan,undefined);
  const next=ask('Same thing for nights',{...world,last:roster.context});
  assert.equal(next.kind,'who');
  assert.match(next.understood,/who is on/);
});
