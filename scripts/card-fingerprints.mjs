#!/usr/bin/env node
// Writes docs/CARD-FINGERPRINTS.md: one fingerprint per card set the app ships, computed exactly as the app computes
// it when the cards are added. A member compares the fingerprint the app shows with this page on GitHub; a test
// fails if this page is out of date. Usage: node scripts/card-fingerprints.mjs [--check]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { setFingerprint } from '../src/assurance.js';
const root = new URL('../', import.meta.url), read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const files = ['src/reference/cards-blood-gases.json', ...readdirSync(new URL('src/reference/guidelines/', root)).filter(name => name.endsWith('.json')).sort().map(name => 'src/reference/guidelines/' + name)];
const rows = [];
for (const file of files) { const set = read(file); rows.push('| ' + set.id + ' | ' + set.title + ' | `' + await setFingerprint(set) + '` |'); }
const page = '# Card set fingerprints\n\nEach card set Department Hub ships, and the fingerprint the app records when the set is added. Open a set in the\napp (Protocols, then the set) and compare its "Card set fingerprint" with this table. If they match, the cards on that\ndevice are the cards published here. If they differ, the cards on that device are not these cards.\n\nThis page is written by `node scripts/card-fingerprints.mjs`, and a test fails if it is out of date. Its history on\nGitHub is the independent record: a device can change its own cards and fingerprint, but not this page\'s history.\n\n| Set | Title | Fingerprint (SHA-256) |\n| --- | --- | --- |\n' + rows.join('\n') + '\n';
const target = new URL('docs/CARD-FINGERPRINTS.md', root);
if (process.argv.includes('--check')) { const held = readFileSync(target, 'utf8'); if (held !== page) { console.error('docs/CARD-FINGERPRINTS.md is out of date. Run node scripts/card-fingerprints.mjs'); process.exit(1); } console.log('Fingerprints page is current.'); }
else { writeFileSync(target, page); console.log(page); }
