#!/usr/bin/env node
// Breaks the protocol feature one way at a time and requires the contract to notice.
//
// A green contract proves little if nothing could turn it red. Each fault below is applied to a throwaway copy of
// the source, the contract (tests/protocol-contract.mjs) is run against that copy, and the named check must fail.
// A fault that changes nothing, because the code it targets has moved, is an error rather than a silent pass. The
// unbroken copy must pass every check first, including the positive control, so refusing everything cannot pass.
//
// Two kinds of fault: a wrong mapping that a person reviewed anyway (data), and a defect in the code (code).
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MAPPING = 'public/fixtures/protocols/rt-train-014-rev1.mapping.json';

// A code fault replaces one exact piece of source. It must match exactly once.
const code = (file, find, replace) => folder => {
  const path = join(folder, file), text = readFileSync(path, 'utf8'), count = text.split(find).length - 1;
  if (count !== 1) throw new Error('The fault no longer applies: ' + JSON.stringify(find.slice(0, 70)) + ' occurs ' + count + ' times in ' + file);
  writeFileSync(path, text.replace(find, replace));
};
// A data fault edits the committed mapping for revision 1, as a person writing it wrongly would.
const data = edit => folder => {
  const path = join(folder, MAPPING), mapping = JSON.parse(readFileSync(path, 'utf8')), before = JSON.stringify(mapping);
  edit(mapping, name => mapping.topics.flatMap(topic => topic.bundles).find(bundle => bundle.id === name), name => mapping.topics.find(topic => topic.id === name));
  if (JSON.stringify(mapping) === before) throw new Error('The data fault changed nothing.');
  writeFileSync(path, JSON.stringify(mapping, null, 1) + '\n');
};
const both = (...steps) => folder => { for (const step of steps) step(folder); };
const without = (bundle, role) => { bundle.links = bundle.links.filter(link => link.role !== role); bundle.requires = bundle.requires.filter(required => required !== role); };
const noUnitGuard = code('src/bundles.js', 'if (held.some(source => source.number === figure.number && source.unit === figure.unit)) continue;', 'continue;');

export const FAULTS = [
  { name: 'remove the contraindication link (mapping reviewed without it)', fails: ['contraindication:'],
    apply: data((mapping, bundle) => without(bundle('start-adult'), 'exception')) },
  { name: 'remove the contraindication link (answers drop that kind of passage)', fails: ['contraindication:'],
    apply: code('src/bundles.js', 'return ROLE_ORDER.map(role => ({ role,', "return ROLE_ORDER.filter(role => role !== 'exception').map(role => ({ role,") },
  { name: 'alter a unit (summary says mk/sec; the figure guard is also removed)', fails: ['unit:'],
    apply: both(noUnitGuard, data((mapping, bundle) => { bundle('start-adult').plain.interpretation = 'Start an adult drill at 12 mk/sec.'; })) },
  { name: 'alter a unit (the figure guard alone is removed)', fails: ['guard:'], apply: noUnitGuard },
  { name: 'alter a unit (summary says mk/sec; the guard is in place)', fails: ['control:', 'unit:'], refusedAtMapping: true,
    apply: data((mapping, bundle) => { bundle('start-adult').plain.interpretation = 'Start an adult drill at 12 mk/sec.'; }) },
  { name: 'select the wrong age branch (the two starting answers are mapped to each other\'s age band)', fails: ['age: a pediatric question'],
    apply: data((mapping, bundle) => { bundle('start-adult').when.age = 'pediatric'; bundle('start-pediatric').when.age = 'adult'; }) },
  { name: 'select the wrong age branch (the age band said is ignored in favour of the first choice)', fails: ['age: a pediatric question'],
    apply: code('src/pathways.js', 'if (said.length === 1) found[name] = said[0].value;', 'if (said.length === 1) found[name] = facts[name].options[0].value;') },
  { name: 'select the wrong age branch ("Not known" is taken as the first choice)', fails: ['age: when the age band is not given'],
    apply: code('src/pathways.js', "if (typed === NOT_KNOWN.toLowerCase() || UNSURE.test(typed)) return UNKNOWN;", "if (typed === NOT_KNOWN.toLowerCase() || UNSURE.test(typed)) return fact.options[0].value;") },
  { name: 'remove the order requirement (mapping no longer asks about or links the order)', fails: ['order: the order requirement'],
    apply: data((mapping, bundle, topic) => { without(bundle('start-adult'), 'order'); without(bundle('start-pediatric'), 'order'); delete bundle('start-adult').when.order; delete bundle('start-pediatric').when.order;
      const start = topic('start'); start.needs = ['age']; start.bundles = start.bundles.filter(entry => entry.id !== 'start-no-order'); }) },
  { name: 'remove the order requirement (an order not mentioned is taken as present)', fails: ['order: the order requirement'],
    apply: code('src/pathways.js', "const missing = (topic.needs || []).find(name => !(name in facts));", "if (!('order' in facts)) facts.order = 'yes';\n  const missing = (topic.needs || []).find(name => !(name in facts));") },
  { name: 'remove the order requirement (an unknown order is taken as present)', fails: ['order: the order requirement'],
    apply: code('src/bundles.js', "given[fact] === value || (loose && given[fact] === UNKNOWN));\n  const sure", "given[fact] === value || given[fact] === UNKNOWN);\n  const sure") },
  { name: 'reuse a superseded revision (the earliest revision in force is used)', fails: ['replacement: once revision 2 is active'],
    apply: code('src/protocols.js', 'const top = inForce.filter(revision => revision.effective === inForce[0].effective);', 'const top = inForce.filter(revision => revision.effective === inForce.at(-1).effective);') },
  { name: 'reuse a superseded revision (falls back to the last active revision while the new one is unreviewed)', fails: ['replacement: until revision 2 is reviewed'],
    apply: code('src/protocols.js', "const revision = top[0], answerable = revision.state === 'active';", "const revision = top[0].state === 'active' ? top[0] : inForce.find(entry => entry.state === 'active') || top[0], answerable = revision.state === 'active';") },
  { name: 'reuse a superseded revision (a mapping is accepted for a file it was not written against)', fails: ['replacement: an answer mapped to revision 1'],
    apply: code('src/bundles.js', 'if (mapping.revision !== revision.digest) return [', 'if (false) return [') },
  { name: 'answer from an unreviewed mapping (the review seal is not compared)', fails: ['review:'],
    apply: code('src/bundles.js', 'Boolean(bundle.review) && bundle.review.seal === sealed(revision, topic, bundle) &&', 'Boolean(bundle.review) &&') },
  { name: 'answer before the effective date (a revision made active early answers at once)', fails: ['future date:'],
    apply: code('src/protocols.js', 'const inForce = live.filter(revision => revision.effective <= today),', 'const inForce = live,') }
];

function contract(folder) {
  const run = spawnSync(process.execPath, ['tests/protocol-contract.mjs', '--json'], { cwd: folder, encoding: 'utf8' });
  try { return JSON.parse(run.stdout.trim().split('\n').at(-1)); } catch { throw new Error('The contract did not run: ' + (run.stderr || run.stdout).slice(0, 400)); }
}
function copy() {
  const folder = mkdtempSync(join(tmpdir(), 'department-hub-fault-'));
  for (const part of ['src', 'scripts']) cpSync(join(ROOT, part), join(folder, part), { recursive: true });
  mkdirSync(join(folder, 'tests', 'eval'), { recursive: true }); mkdirSync(join(folder, 'public', 'fixtures'), { recursive: true });
  for (const file of ['tests/protocol-contract.mjs', 'tests/protocol-kit.mjs', 'tests/eval/world.mjs', 'package.json']) cpSync(join(ROOT, file), join(folder, file));
  cpSync(join(ROOT, 'tests', 'fixtures'), join(folder, 'tests', 'fixtures'), { recursive: true });
  cpSync(join(ROOT, 'public', 'fixtures', 'protocols'), join(folder, 'public', 'fixtures', 'protocols'), { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(folder, 'node_modules'), 'dir');
  return folder;
}

export function runFaults() {
  const report = { control: null, faults: [] };
  const clean = copy();
  try { const results = contract(clean); report.control = { checks: results.length, failed: results.filter(result => !result.ok).map(result => result.name + ' — ' + result.why) }; }
  finally { rmSync(clean, { recursive: true, force: true }); }
  for (const fault of FAULTS) {
    const folder = copy();
    try {
      fault.apply(folder);
      const results = contract(folder), failed = results.filter(result => !result.ok);
      const missed = fault.fails.filter(prefix => !failed.some(result => result.name.startsWith(prefix)));
      report.faults.push({ name: fault.name, caught: !missed.length, missed, failed: failed.map(result => result.name), why: failed.find(result => fault.fails.some(prefix => result.name.startsWith(prefix)))?.why || '' });
    } catch (error) { report.faults.push({ name: fault.name, caught: false, missed: fault.fails, failed: [], error: String(error.message) }); }
    finally { rmSync(folder, { recursive: true, force: true }); }
  }
  report.ok = report.control.failed.length === 0 && report.faults.every(fault => fault.caught);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runFaults();
  console.log((report.control.failed.length ? 'FAIL' : 'PASS') + '  unbroken: all ' + report.control.checks + ' contract checks pass, positive control included');
  for (const line of report.control.failed) console.log('        ' + line);
  for (const fault of report.faults) {
    console.log((fault.caught ? 'PASS' : 'FAIL') + '  ' + fault.name);
    console.log('        ' + (fault.error ? fault.error : fault.caught ? 'caught by: ' + fault.failed.filter(name => FAULTS.find(entry => entry.name === fault.name).fails.some(prefix => name.startsWith(prefix))).join('; ') + '\n        ' + fault.why
      : 'NOT CAUGHT. Expected a failure in: ' + fault.missed.join(', ') + '. Failed instead: ' + (fault.failed.join('; ') || 'nothing')));
  }
  console.log(report.ok ? 'Every fault was caught: ' + report.faults.length + ' of ' + report.faults.length + '.' : 'The contract missed a fault, or the unbroken copy failed.');
  process.exit(report.ok ? 0 : 1);
}
