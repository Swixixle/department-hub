#!/usr/bin/env node
// Optional. Rebuilds the reference list the app ships (src/reference/respiratory-sources.json) from the catalog as
// it was received (docs/reference/respiratory-source-catalog-2026-11-12.json). No build or test runs this; a test
// checks that the shipped list is exactly what this script produces, so the shipped list cannot drift by hand.
//
// What is left out, on purpose: the descriptions. Twelve records came with a few sentences describing the document,
// written by an AI assistant. A description of a clinical guideline that no person has checked against it is an
// unreviewed interpretation, and this app shows none. A title, a year, who lists it and a link are facts about where
// a document is; they say nothing about what to do.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = path => fileURLToPath(new URL('../' + path, import.meta.url));
export const RECEIVED = 'docs/reference/respiratory-source-catalog-2026-11-12.json', SHIPPED = 'src/reference/respiratory-sources.json';

export function shipped(received) {
  const kept = received.records.map(record => ({ id: record.id, title: record.title, short: record.display_title, url: record.source_url, section: record.index_category, topic: record.index_topic || null,
    groups: record.topics, issuer: record.issuer, year: record.listed_year || null, retired: Boolean(record.retired), kind: record.source_kind, foundAt: record.discovered_at_url, related: record.related_source_ids,
    rights: record.rights.basis, ...(record.version_note ? { versionNote: record.version_note } : {}) }));
  return { format: 'department-hub-reference-list-v1', collectedOn: received.prepared_on,
    note: 'Titles, years and links to official originals. No guideline text and no description of what any document recommends. A listing is not proof that a document is current or adopted anywhere.',
    // What was independently checked after the catalog was received, and what was not. See docs/REFERENCE-CATALOG.md.
    checked: { on: '2026-11-12', aarcGuidelineIndex: 'All 94 entries match the live index: same section, title, link and order.', aarcGuidanceDocuments: 'All 5 match the live page.',
      aarcHostedLinks: 'All 76 links to files on aarc.org answered as PDFs.', otherLinks: 'Of 23 links to other organizations, 7 were confirmed to reach the named document. The rest could not be confirmed.', nbrc: 'All 7 NBRC links answered. Two are short links that lead to NBRC’s current file.' },
    sections: Object.keys(received.counts), records: kept };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const list = shipped(JSON.parse(readFileSync(at(RECEIVED), 'utf8')));
  writeFileSync(at(SHIPPED), JSON.stringify(list, null, 1) + '\n');
  console.log('wrote', SHIPPED, list.records.length, 'records');
}
