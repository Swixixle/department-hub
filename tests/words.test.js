import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editDistance, expand, keywords, nearest, stem, tidyQuestion } from '../src/words.js';

test('edit distance counts inserts, deletes, substitutions and swapped neighbours', () => {
  assert.deepEqual([editDistance('friday', 'friday'), editDistance('firday', 'friday'), editDistance('tomorow', 'tomorrow'), editDistance('keshia', 'kesha'), editDistance('cat', 'dog', 2)], [0, 1, 1, 1, 3]);
  assert.equal(nearest('firday', ['monday', 'friday', 'fridge']), 'friday');
  assert.equal(nearest('schedual', ['schedule', 'scheduled']), 'schedule');
  assert.equal(nearest('zebra', ['monday', 'friday']), null);
  assert.equal(nearest('work', ['word', 'fork']), 'word');
});

test('word endings meet at one stem', () => {
  assert.deepEqual(['requesting', 'requests', 'requested', 'request'].map(stem), ['request', 'request', 'request', 'request']);
  assert.deepEqual([stem('policies'), stem('policy'), stem('leaving'), stem('leave'), stem('swapping'), stem('shifts'), stem('census'), stem('class')], ['policy', 'policy', 'leav', 'leav', 'swap', 'shift', 'census', 'class']);
  assert.deepEqual(keywords('How do I go about requesting the days off?'), ['about', 'request', 'day', 'off'].filter(word => word !== 'about'));
});

test('shorthand and misspellings are read as known words, and the change is reported', () => {
  const names = ['Morgan', 'Harper', 'Jordan K', 'Avery'];
  const read = text => tidyQuestion(text, names, new Set(['filter', 'supply']));
  assert.equal(read('whos workin tmrw nite').text, 'who is working tomorrow night');
  assert.equal(read('wen do i work nxt').text, 'when do i work next');
  assert.equal(read('is Morgn on firday?').text, 'is morgan on friday');
  assert.deepEqual(read('is Morgn on firday?').changes, [['morgn', 'morgan'], ['firday', 'friday']]);
  assert.equal(read('harpers schedual this wknd').text, 'harpers schedule this weekend');
  assert.equal(read('am i working thanksgivng').text, 'am i working thanksgiving');
  assert.equal(read('who am i w/ sat').text, 'who am i with saturday');
  // A word the department itself uses is left alone, and so is a word nothing is close to.
  assert.deepEqual(read('where are the filters').changes, []);
  assert.deepEqual(read('what about the zebra').changes, []);
  // A person called Sun or Fri keeps their name.
  assert.equal(tidyQuestion('is sun on tonight', ['Sun']).text, 'is sun on tonight');
});

test('the department’s other words for a thing are added to what is looked for', () => {
  assert.ok(expand('how do i get pto').includes('leave'));
  assert.ok(expand('can i swap shifts').includes('trade'));
  assert.ok(expand('who got called off').includes('low census'));
  assert.deepEqual(expand('where are the filters'), []);
  assert.ok(expand('codes', [['code blue', 'codes']]).includes('code blue'));
});
