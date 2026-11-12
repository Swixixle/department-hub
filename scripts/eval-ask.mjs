// Scores Ask against an evaluation set, in the four categories the coworker exercise uses:
// correct answer, useful clarification, unhelpful non-answer, confidently wrong answer.
//
//   npm run eval:ask                 both sets
//   npm run eval:ask -- set-b        one set
//   npm run eval:ask -- set-b --show every question and what it was read as
//
// What a number from this is worth: the sets were written by the person who wrote the engine, who knew which words
// it recognises. They measure whether a stated constraint survives into the plan. They do not measure whether a
// respiratory therapist's own wording is understood — that is what docs/ASK-EXERCISE.md is for, and it needs
// coworkers, not more test files.
//
// Both sets have been tuned against, and each says so below. The honest number from a set is the one measured
// BEFORE anything was changed in response to it; after that it reports whether a fix held, not how good the engine
// is. A new measurement needs a new set.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ask } from '../src/ask.js';
import { world } from '../tests/eval/world.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const argv = process.argv.slice(2);
const show = argv.includes('--show');
const wanted = argv.filter(value => !value.startsWith('--'));
const sets = (wanted.length ? wanted : ['set-a', 'set-b']).map(name => name.replace(/\.json$/, ''));

// What each set measured the first time it was run, before anything was changed because of it.
const BEFORE = {
  'set-a': 'first run, before any fix: 49 correct, 0 clarifications, 12 non-answers, 2 confidently wrong of 63',
  'set-b': 'first run, before any fix: 42 correct, 0 clarifications, 4 non-answers, 2 confidently wrong of 48'
};

let worst = 0;
for (const name of sets) {
  const cases = JSON.parse(readFileSync(resolve(root, 'tests/eval', name + '.json'), 'utf8'));
  const tally = { correct: [], clarified: [], nonAnswer: [], wrong: [] };
  for (const [question, want] of cases) {
    const found = ask(question, world);
    const plan = found.context?.plan || null;
    const isPlan = ['rank', 'compare', 'count'].includes(found.kind);
    const clarifies = /I can read that question but I cannot work out|I do not have anybody on the schedule called|A fair share is worked out within one shift|^Which/.test(found.title || '');

    if (want.notAPlan) {
      if (!isPlan) tally.correct.push([question, found.kind]);
      else tally.wrong.push([question, 'claimed as a comparison: ' + found.understood]);
      continue;
    }
    if (want.unsupported) {
      if (/cannot work out/.test(found.title || '')) tally.correct.push([question, 'refused: ' + found.title.slice(0, 60)]);
      else if (clarifies) tally.clarified.push([question, found.title.slice(0, 60)]);
      else if (isPlan) tally.wrong.push([question, 'answered anyway: ' + found.understood]);
      else tally.nonAnswer.push([question, found.kind + ': ' + (found.title || '').slice(0, 50)]);
      continue;
    }
    if (want.unresolved) {
      if (/I do not have anybody on the schedule called/.test(found.title || '')) tally.correct.push([question, 'named the unknown name']);
      else if (isPlan) tally.wrong.push([question, 'dropped the name: ' + found.understood]);
      else tally.nonAnswer.push([question, found.kind]);
      continue;
    }
    if (!isPlan) { tally.nonAnswer.push([question, found.kind + ': ' + (found.title || '').slice(0, 50)]); continue; }

    const off = [];
    if (want.op && plan?.op !== want.op) off.push('op ' + plan?.op + ' not ' + want.op);
    if (want.metric && plan?.metric !== want.metric) off.push('metric ' + plan?.metric + ' not ' + want.metric);
    if (want.direction && plan?.direction !== want.direction) off.push('direction ' + plan?.direction + ' not ' + want.direction);
    if ('shift' in want && (plan?.shift ?? null) !== want.shift) off.push('shift ' + plan?.shift + ' not ' + want.shift);
    if (want.limit && plan?.limit !== want.limit) off.push('limit ' + plan?.limit + ' not ' + want.limit);
    if (want.exclude) {
      const got = (plan?.exclude || []).slice().sort().join(','), need = want.exclude.slice().sort().join(',');
      if (got !== need) off.push('exclude [' + got + '] not [' + need + ']');
    }
    if (want.people) {
      const got = (plan?.people || []).slice().sort().join(',');
      if (!want.people.every(name => got.includes(name))) off.push('people [' + got + '] missing ' + want.people.join(','));
    }
    if (want.period && !plan?.when) off.push('the period was dropped');
    if (off.length) tally.wrong.push([question, off.join('; ')]);
    else tally.correct.push([question, found.understood]);
  }

  console.log(name + ': ' + cases.length + ' questions');
  console.log('  correct answer ............. ' + tally.correct.length);
  console.log('  useful clarification ....... ' + tally.clarified.length);
  console.log('  unhelpful non-answer ....... ' + tally.nonAnswer.length);
  console.log('  confidently wrong answer ... ' + tally.wrong.length);
  console.log('  ' + BEFORE[name]);
  for (const [label, list] of [['confidently wrong', tally.wrong], ['unhelpful non-answer', tally.nonAnswer], ['useful clarification', tally.clarified]]) {
    if (!list.length) continue;
    console.log('  ' + label + ':');
    for (const [question, why] of list) console.log('    ' + JSON.stringify(question) + '\n        ' + why);
  }
  if (show) { console.log('  every question:'); for (const [question, why] of tally.correct) console.log('    ' + JSON.stringify(question) + '\n        ' + why); }
  console.log();
  worst = Math.max(worst, tally.wrong.length);
}
// A confidently wrong answer is the category that matters: it fails the run.
process.exit(worst ? 1 : 0);
