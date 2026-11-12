#!/usr/bin/env node
// Builds the guideline cards that ship, from a card spec in scripts/guideline-specs/ and the owner's own Blinders
// capture of the guideline, which stays on the owner's computer and is never written into the repository.
// Usage: node scripts/make-guideline-cards.mjs <spec.json> <capture.txt> <capture.receipt.json>
// Every card is checked against its passage of the capture: the passage exists and every number the card states is in
// it. The output holds the cards, where each passage is, and a fingerprint of its words; no text of the guideline.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildSet } from '../src/guidelines.js';
const [specPath, capturePath, receiptPath] = process.argv.slice(2);
if (!receiptPath) { console.error('Usage: node scripts/make-guideline-cards.mjs <spec.json> <capture.txt> <capture.receipt.json>'); process.exit(2); }
const spec = JSON.parse(readFileSync(specPath, 'utf8')), text = readFileSync(capturePath, 'utf8'), receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
const result = await buildSet(spec, text, receipt);
if (!result.ok) { console.error('Refused:\n  ' + result.problems.join('\n  ')); process.exit(1); }
const out = new URL('../src/reference/guidelines/' + spec.id + '.json', import.meta.url);
writeFileSync(out, JSON.stringify(result.set, null, 1) + '\n');
console.log('Wrote ' + out.pathname + ': ' + result.set.cards.length + ' cards, every number found in its passage of capture ' + receipt.id + '.');
