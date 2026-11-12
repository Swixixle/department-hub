import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIdentity, identifyBuild } from '../scripts/build-identity.mjs';
import { checkBuild } from '../scripts/check-build.mjs';
import { installLocal } from '../scripts/install-local.mjs';
import { sourceRevision } from '../scripts/source-revision.mjs';

test('source identity names the actual clean commit and marks modified or unknown sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'department-hub-source-'));
  const git = args => execFileSync('git', args, { cwd:root, encoding:'utf8', stdio:['ignore','pipe','ignore'] }).trim();
  try {
    assert.deepEqual(sourceRevision(root), {commit:null,dirty:null});
    git(['init']);
    git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','Fixture']);
    assert.deepEqual(sourceRevision(root), {commit:git(['rev-parse','HEAD']),dirty:false});
    await symlink(root,root+'-alias','dir');
    assert.deepEqual(sourceRevision(root+'-alias'), {commit:git(['rev-parse','HEAD']),dirty:false});
    await writeFile(join(root, 'changed.txt'), 'Synthetic uncommitted change');
    assert.equal(sourceRevision(root).dirty,true);
    const nested = join(root, 'unrelated-copy'); await mkdir(nested);
    assert.deepEqual(sourceRevision(nested), {commit:null,dirty:null});
  } finally { await rm(root+'-alias', {force:true}); await rm(root, {recursive:true,force:true}); }
});

test('source identity is covered by the manifest fingerprint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'department-hub-manifest-'));
  try {
    await writeFile(join(root, 'index.html'), '<html><head></head><body>Fixture</body></html>');
    const first = await identifyBuild(root, 'production', {commit:'a'.repeat(40),dirty:false});
    const second = await identifyBuild(root, 'production', {commit:'b'.repeat(40),dirty:false});
    assert.deepEqual(first.files,second.files);
    assert.notEqual(first.fingerprint,second.fingerprint);
  } finally { await rm(root, {recursive:true,force:true}); }
});

test('standalone updates install exactly one verified release and preserve the complete old folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'department-hub-install-'));
  try {
    const release = join(root, 'release'), target = join(root, 'standalone');
    await mkdir(join(release, 'assets'), {recursive:true});
    await writeFile(join(release, 'index.html'), '<html><head><title>Department Hub</title></head><body>New</body></html>');
    await writeFile(join(release, 'assets', 'current.js'), 'console.log("new fixture");');
    const plugin = buildIdentity({commit:'a'.repeat(40),dirty:false}); plugin.configResolved({mode:'production'});
    await plugin.writeBundle.handler({dir:release});
    await mkdir(join(target, 'app', 'assets'), {recursive:true});
    await writeFile(join(target, 'app', 'index.html'), '<title>Department Hub</title>Old');
    await writeFile(join(target, 'app', 'assets', 'stale.js'), 'Old bytes');
    await writeFile(join(target, 'keep.txt'), 'Unrelated local file');
    await writeFile(join(target, 'serve.py'), '# Existing launcher');
    const installed = await installLocal({release,target});
    assert.deepEqual(checkBuild(installed.app),checkBuild(release));
    await assert.rejects(readFile(join(installed.app, 'assets', 'stale.js')), {code:'ENOENT'});
    assert.equal(await readFile(join(installed.previous, 'assets', 'stale.js'), 'utf8'),'Old bytes');
    assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'),'Unrelated local file');
    assert.equal(await readFile(join(target, 'serve.py'), 'utf8'),'# Existing launcher');
    await writeFile(join(release, 'assets', 'current.js'), 'Damaged candidate');
    await assert.rejects(installLocal({release,target}), /Release file/);
    assert.deepEqual(checkBuild(installed.app).fingerprint,installed.fingerprint);
  } finally { await rm(root, {recursive:true,force:true}); }
});
