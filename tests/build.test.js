import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIdentity, identifyBuild, manifestFingerprint, normalizeBuildHtml } from '../scripts/build-identity.mjs';

async function fixture(folder) {
  await mkdir(join(folder, 'assets'));
  for (const [name, bytes] of [['index.html','<!doctype html><html><head><title>Test</title></head><body></body></html>'],
    ['assets/index-demo.js','console.log("fixture");'],['assets/style-demo.css',':root { color: green; }'],['mark.svg','<svg>fixture</svg>']])
    await writeFile(join(folder, name), bytes);
}

test('release identity is reproducible and changes for code, styles, public files and mode', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'department-hub-build-'));
  try {
    await fixture(folder);
    const initial = await identifyBuild(folder, 'production');
    assert.match(initial.fingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(await identifyBuild(folder, 'production'), initial);
    const code = await readFile(join(folder, 'assets/index-demo.js'));
    await writeFile(join(folder, 'assets/index-demo.js'), 'console.log("changed");');
    assert.notEqual((await identifyBuild(folder, 'production')).fingerprint, initial.fingerprint);
    await writeFile(join(folder, 'assets/index-demo.js'), code);
    const styles = await readFile(join(folder, 'assets/style-demo.css'));
    await writeFile(join(folder, 'assets/style-demo.css'), 'p { font-size: 18px; }');
    assert.notEqual((await identifyBuild(folder, 'production')).fingerprint, initial.fingerprint);
    await writeFile(join(folder, 'assets/style-demo.css'), styles);
    assert.notEqual((await identifyBuild(folder, 'demo')).fingerprint, initial.fingerprint);
    await writeFile(join(folder, 'mark.svg'), '<svg>changed</svg>');
    assert.notEqual((await identifyBuild(folder, 'production')).fingerprint, initial.fingerprint);
  } finally { await rm(folder, { recursive:true, force:true }); }
});

test('the generated HTML and manifest share an identity covering the normalized release bytes', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'department-hub-release-'));
  try {
    await fixture(folder);
    const plugin = buildIdentity();
    plugin.configResolved({ mode:'production' });
    await plugin.writeBundle.handler({ dir:folder });
    const manifest = JSON.parse(await readFile(join(folder, 'build-info.json'), 'utf8'));
    assert.equal(manifestFingerprint(manifest), manifest.fingerprint);
    assert.ok((await readFile(join(folder, 'index.html'), 'utf8')).includes('content="' + manifest.fingerprint + '"'));
    for (const [name, hash] of manifest.files) {
      const file = await readFile(join(folder, name)), bytes = name === 'index.html' ? normalizeBuildHtml(file.toString()) : file;
      assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, name);
    }
    assert.equal((await identifyBuild(folder, 'production')).fingerprint, manifest.fingerprint);
    await plugin.writeBundle.handler({ dir:folder });
    assert.equal(JSON.parse(await readFile(join(folder, 'build-info.json'), 'utf8')).fingerprint, manifest.fingerprint);
  } finally { await rm(folder, { recursive:true, force:true }); }
});
