import { constants } from 'node:fs';
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBuild } from './check-build.mjs';

export async function installLocal({ release = 'dist', target }) {
  if (!target) throw new Error('Supply --target with the standalone Department Hub folder');
  const input = resolve(release), root = resolve(target), app = join(root, 'app');
  if (root === input || root.startsWith(input + sep) || input.startsWith(app + sep) || input === app)
    throw new Error('Build output and installed app must be separate directories');
  const manifest = checkBuild(input);
  if (manifest.mode !== 'production') throw new Error('The standalone app requires a production build, not the public demo');
  const existing = await lstat(app).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('The existing app must be a regular directory');
  if (existing && !/<title>\s*Department Hub\s*<\/title>/.test(await readFile(join(app, 'index.html'), 'utf8')))
    throw new Error('The existing app is not identified as Department Hub');
  await mkdir(root, { recursive:true });
  const stage = await mkdtemp(join(root, '.department-hub-next-'));
  await cp(input, stage, { recursive:true });
  if (checkBuild(stage).fingerprint !== manifest.fingerprint) throw new Error('The release changed while being copied; build it again before installing');
  const previous = existing ? join(root, 'app-before-update-' + randomUUID()) : null;
  if (previous) await rename(app, previous);
  try { await rename(stage, app); }
  catch (error) { if (previous) await rename(previous, app); throw error; }
  // Leave an existing launcher and every other file alone. Never overlay or delete the old app.
  await copyFile(fileURLToPath(new URL('./serve.py', import.meta.url)), join(root, 'serve.py'), constants.COPYFILE_EXCL)
    .catch(error => { if (error.code !== 'EEXIST') throw error; });
  return { app, previous, fingerprint:manifest.fingerprint, source:manifest.source || null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), at = args.indexOf('--target');
  const result = await installLocal({ target:at >= 0 ? args[at + 1] : null });
  console.log(JSON.stringify(result, null, 2));
}
