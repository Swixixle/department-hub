import test from 'node:test';
import assert from 'node:assert/strict';
import { ask } from '../src/ask.js';
import { world } from './eval/world.mjs';

test('behind names people below the reference, rather than above it',()=>{
  const result=ask('Who is behind Blair on weekend day shifts?',world);
  assert.equal(result.context.plan.direction,'lowest');
  assert.deepEqual(new Set(result.items.map(row=>row.text)),new Set([
    'Casey: 4 weekend shifts','Emery: 2 weekend shifts','Indigo: 0 weekend shifts','Blair: 5 weekend shifts'
  ]));
  assert.match(result.understood,/fewer weekend shifts than Blair/);
});

test('an exclusion cannot substitute for an unknown comparison reference',()=>{
  const result=ask('Who has more weekend day shifts than Zephyrine, excluding Avery?',world);
  assert.match(result.title,/I do not have anybody on the schedule called Zephyrine/);
  assert.deepEqual(result.items,[]);
  assert.equal(result.context.plan.than,null);
});

test('multiple references and a second boundary cannot be silently reduced to one',()=>{
  for(const q of [
    'Who has more weekend day shifts than Casey and Blair?',
    'Who has more weekend day shifts than Blair but fewer than Avery?'
  ]) {
    const result=ask(q,world);
    assert.match(result.title,/cannot work out/,q);
    assert.deepEqual(result.items,[],q);
    assert.ok(result.context.plan.unsupported.length,q);
  }
});

test('negation is retained instead of answering its opposite',()=>{
  const result=ask('Who has no more weekend day shifts than Blair?',world);
  assert.match(result.title,/cannot work out/);
  assert.deepEqual(result.items,[]);
  assert.ok(result.context.plan.unsupported.length);
});

test('a threshold ranking limit is applied and keeps ties at the cutoff',()=>{
  const one=ask('Who has the top 1 weekend day shift count above Casey?',world);
  assert.deepEqual(one.items.map(row=>row.text),['Avery: 6 weekend shifts','Casey: 4 weekend shifts']);
  const two=ask('Who has the top 2 weekend day shift counts above Casey?',world);
  assert.deepEqual(two.items.map(row=>row.text),[
    'Avery: 6 weekend shifts','Blair: 5 weekend shifts','Jamie: 5 weekend shifts','Casey: 4 weekend shifts'
  ]);
});

test('an explicit reference correction changes the reference without losing the other fields',()=>{
  const first=ask('Who has more weekend day shifts than Blair?',world);
  const repaired=ask('No, fewer than Casey',{...world,last:first.context});
  assert.equal(repaired.kind,'threshold');
  assert.equal(repaired.context.plan.than,'Casey');
  assert.equal(repaired.context.plan.shift,'D');
  assert.deepEqual(new Set(repaired.items.map(row=>row.text)),new Set([
    'Indigo: 0 weekend shifts','Emery: 2 weekend shifts','Casey: 4 weekend shifts'
  ]));
});

test('a shift-only follow-up cannot erase an unresolved threshold constraint',()=>{
  const first=ask('Who has more weekend day shifts than Blair but fewer than Avery?',world);
  const repaired=ask('Same thing for nights',{...world,last:first.context});
  assert.match(repaired.title,/cannot work out/);
  assert.deepEqual(repaired.items,[]);
});

test('unknown reference details are not disclosed as named figures to a non-custodian',()=>{
  for(const q of ['Who is behind Blair on weekend day shifts?',
    'Who has more weekend day shifts than Casey?']) {
    const result=ask(q,{...world,keeper:false});
    assert.match(result.title,/kept by whoever keeps the record/);
    assert.deepEqual(result.items,[]);
  }
});
