import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const marker = '<meta name="department-hub-build" content="">';
export const normalizeBuildHtml = html => html.replace(/<meta name="department-hub-build" content="[a-f0-9]{64}">/, marker);
export const manifestFingerprint = manifest => digest(JSON.stringify({ format:manifest.format, mode:manifest.mode, files:manifest.files }));
const canonicalHtml = html => {
  const normalized = normalizeBuildHtml(html);
  return normalized.includes(marker) ? normalized : normalized.replace('</head>', marker + '\n</head>');
};

async function releaseFiles(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes:true })) {
    const name = prefix + entry.name, path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await releaseFiles(path, name + '/'));
    else if (entry.isFile() && name !== 'build-info.json') {
      const bytes = await readFile(path);
      result.push([name, digest(name === 'index.html' ? canonicalHtml(bytes.toString()) : bytes)]);
    }
  }
  return result;
}

export async function identifyBuild(directory, mode) {
  const manifest = { format:'department-hub-build-v1', mode, files:(await releaseFiles(directory)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) };
  return { ...manifest, fingerprint:manifestFingerprint(manifest) };
}

export function buildIdentity() {
  let config;
  return {
    name:'department-hub-build-identity', apply:'build', enforce:'post',
    configResolved(value) { config = value; },
    writeBundle: {
      order:'post', sequential:true,
      async handler(options) {
        if (!options.dir) throw new Error('Missing build output directory');
        // Read finished files: Vite can still change chunks after generateBundle hooks.
        // Only the HTML's identity value is blanked; the manifest cannot hash itself.
        const manifest = await identifyBuild(options.dir, config.mode);
        const html = canonicalHtml(await readFile(join(options.dir, 'index.html'), 'utf8'));
        await writeFile(join(options.dir, 'index.html'), html.replace(marker,
          marker.replace('content=""', 'content="' + manifest.fingerprint + '"')));
        await writeFile(join(options.dir, 'build-info.json'), JSON.stringify(manifest, null, 2) + '\n');
      }
    }
  };
}
