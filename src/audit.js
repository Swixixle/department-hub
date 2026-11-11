// Integrity checks, not encryption or proof of a person's identity. A separately retained checkpoint is needed to
// detect removal of the tail or replacement of an entire locally writable history.
export const sha256 = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  typeof data === 'string' ? new TextEncoder().encode(data) : data))).map(byte => byte.toString(16).padStart(2, '0')).join('');

export const documentVersion = doc => sha256(JSON.stringify([doc.id, doc.title, doc.kind, doc.effective || '', doc.text, doc.by || '', doc.added || '', doc.status || 'active']));
export const postVersion = post => sha256(JSON.stringify([post.id, post.author, post.created, post.body || '', post.when || null,
  Boolean(post.learning), Boolean(post.inside), Boolean(post.voice), post.media || []]));

export async function fileFingerprint(file, { chunkBytes = 8 * 1024 * 1024, wholeLimit = 8 * 1024 * 1024 } = {}) {
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 16 * 1024 * 1024) throw new Error('Invalid fingerprint chunk size');
  if (file.size <= wholeLimit) return { bytes:file.size, method:'sha256', sha256:await sha256(await file.arrayBuffer()) };
  const hashes = [];
  for (let from = 0; from < file.size; from += chunkBytes) hashes.push(await sha256(await file.slice(from, from + chunkBytes).arrayBuffer()));
  // Hash every chunk. This is a SHA-256 chunk-manifest fingerprint, explicitly distinct from SHA256(file bytes).
  return { bytes:file.size, method:'sha256-chunks-v1', chunkBytes, chunks:hashes.length,
    sha256:await sha256('department-hub/file-v1:' + JSON.stringify({ bytes:file.size, chunkBytes, hashes })) };
}

export async function verifyReceipts(events, checkpoint = '') {
  if (!Array.isArray(events)) return { ok:false, at:0, why:'is not a receipt list' };
  let previous = null;
  const ids = new Set();
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (!event || typeof event !== 'object' || !/^[a-f0-9]{64}$/.test(event.hash || '') || !event.id || ids.has(event.id))
      return { ok:false, at:index + 1, why:'has an invalid fingerprint or repeated identity' };
    const { hash, ...payload } = event;
    if (payload.previousHash !== previous) return { ok:false, at:index + 1, why:'does not follow the receipt before it' };
    if (await sha256(JSON.stringify(payload)) !== hash) return { ok:false, at:index + 1, why:'has been changed since it was written' };
    previous = hash; ids.add(event.id);
  }
  if (checkpoint) {
    if (!/^[a-f0-9]{64}$/.test(checkpoint)) return { ok:false, at:0, why:'requires the complete 64-character checkpoint fingerprint' };
    const at = events.findIndex(event => event.hash === checkpoint);
    if (at < 0) return { ok:false, at:0, why:'does not contain the independently saved checkpoint; the history may be truncated, replaced or from a different workspace' };
    return { ok:true, count:events.length, checkpoint:at + 1 };
  }
  return { ok:true, count:events.length, checkpoint:null };
}

export async function verifyContent({ events, posts = [], documents = [], file = async () => null }) {
  const issues = [], unavailable = [], legacy = [];
  let checked = 0;
  const latest = (type, id) => events.findLast(event => event.type === type && event.details?.id === id)?.details;
  for (const doc of documents) {
    const record = latest('Document added', doc.id);
    if (!record?.sha256) { legacy.push('Document ' + doc.title); continue; }
    checked++;
    if (!record.version) legacy.push('Document ' + doc.title + ' metadata predates version fingerprints');
    if (await sha256(doc.text) !== record.sha256 || (record.version && await documentVersion(doc) !== record.version)) issues.push('Document ' + doc.title + ' differs from its receipt.');
  }
  for (const post of posts) {
    const record = latest('Board update', post.id);
    if (!record?.fingerprint) { legacy.push('Post ' + post.id); continue; }
    checked++;
    if (!record.postHash) legacy.push('Post ' + post.id + ' metadata predates version fingerprints');
    if (await sha256(post.body || '') !== record.fingerprint || (record.postHash && await postVersion(post) !== record.postHash)) issues.push('Post ' + post.id + ' differs from its receipt.');
    for (let index = 0; index < (post.media || []).length; index++) {
      const item = post.media[index], expected = record.files?.[index];
      if (!expected || expected.covers) { legacy.push('File ' + item.name + ' has no complete fingerprint'); continue; }
      const blob = await file(item.id);
      if (!blob) { unavailable.push('File ' + item.name); continue; }
      const actual = await fileFingerprint(blob, expected.method === 'sha256-chunks-v1' ? { chunkBytes:expected.chunkBytes, wholeLimit:-1 } : { wholeLimit:Infinity });
      checked++;
      if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) issues.push('File ' + item.name + ' differs from its receipt.');
    }
  }
  return { ok:!issues.length, checked, issues, unavailable, legacy };
}
