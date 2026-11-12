import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { manifestFingerprint, normalizeBuildHtml } from './build-identity.mjs';

for (const folder of process.argv.slice(2).length ? process.argv.slice(2) : ['dist', 'dist-demo']) {
  const manifest = JSON.parse(readFileSync(join(folder, 'build-info.json'), 'utf8'));
  assert.equal(manifest.format, 'department-hub-build-v1');
  assert.equal(manifestFingerprint(manifest), manifest.fingerprint, 'Build manifest fingerprint');
  const actual = readdirSync(folder, { recursive:true }).filter(name => name !== 'build-info.json' && statSync(join(folder, name)).isFile()).sort();
  assert.deepEqual(manifest.files.map(([name]) => name), actual, 'All release files must be covered');
  for (const [name, expected] of manifest.files) {
    let bytes = readFileSync(join(folder, name));
    if (name === 'index.html') {
      assert.ok(bytes.toString().includes('<meta name="department-hub-build" content="' + manifest.fingerprint + '">'));
      bytes = normalizeBuildHtml(bytes.toString());
    }
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, 'Release file: ' + name);
  }
  console.log('PASS: ' + folder + ' · ' + manifest.mode + ' · ' + manifest.fingerprint + ' · ' + actual.length + ' files');
}
