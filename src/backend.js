// The board's connection to wherever posts and their files are kept.
//
// Today that is this browser: posts ride in the saved workspace and files sit in IndexedDB, so a post reaches nobody
// else. A hosted service takes over by providing the same six functions over HTTP. Nothing else in the app needs to
// know which one is in use. docs/SERVER.md describes the hosted version and what switching it on involves.
//
//   shared            true when other people's devices see the same posts
//   where             a few words for the person: where a post goes
//   list()            every post, oldest first
//   publish(post, files, record)   files: [[mediaId, Blob]]; record: fingerprints for the receipt; resolves when all is stored
//   remove(postId)    takes a post and its files away
//   file(mediaId)     the Blob for one attachment, or nothing if it is not available
//   clear()           forget every file (used when the workspace is erased)
import { clearMedia, deleteMedia, getMedia, putMedia } from './storage.js';

// getPosts(): the posts in the workspace. change(type, details, update): records a receipt and saves update(posts).
export function localBoard({ getPosts, change }) {
  return {
    shared: false,
    where: 'this browser only',
    async list() { return getPosts(); },
    async publish(post, files = [], record = {}) {
      const stored = [];
      try {
        for (const [id, blob] of files) { await putMedia(id, blob); stored.push(id); }
        await change('Board update', { id: post.id, attachments: files.length, voice: Boolean(post.voice), ...record }, posts => [...posts, post]);
      } catch (error) {
        for (const id of stored) await deleteMedia(id).catch(() => {});      // no orphaned files if the post did not save
        throw error;
      }
      return post;
    },
    async remove(postId) {
      const post = getPosts().find(item => item.id === postId);
      if (!post) return;
      await change('Board post removed', { id: postId }, posts => posts.filter(item => item.id !== postId));
      for (const item of post.media || []) await deleteMedia(item.id).catch(() => {});
    },
    async file(mediaId) { return (await getMedia(mediaId)) || null; },
    async clear() { await clearMedia(); }
  };
}

// The same six functions against the department server, so nothing above this line has to know which is in use.
//
// What is different about the shared one, and visible to the person:
//
//   where      says the department, not this browser
//   state      'ready' while the last read worked, 'stale' when a read failed but older posts are still on screen,
//              'failed' when there is nothing to show, 'sending' while a post is on its way, 'unsent' when it
//              did not arrive. The screen shows what is true rather than pretending the post is up.
//   clear()    does nothing. A member wiping their own device must not empty the department.
//
// A post carries an id the phone made before sending. A retry after a dropped connection carries the same one, and
// the server returns the post that is already there, so a flaky signal does not post twice.
// What a server post looks like on the phone's board: the same fields the local board uses, plus who wrote it.
// names(personId) turns the author's id into the name the department knows them by.
export function fromServerPost(post, names = id => id) {
  const extras = post.extras || {};
  return { id: post.id, author: names(post.authorId), authorId: post.authorId, body: post.body, created: post.createdAt,
    ...(extras.learning ? { learning: true } : {}), ...(extras.inside ? { inside: true } : {}), ...(extras.voice ? { voice: true } : {}),
    ...(extras.when ? { when: extras.when } : {}),
    media: (post.media || []).map((item, index) => ({ id: item.id, name: item.name, type: item.contentType, size: item.bytes ?? undefined,
      kind: kindOf(item.contentType, item.name), ...(index === 0 && extras.seconds ? { seconds: extras.seconds } : {}) })) };
}
const kindOf = (type = '', name = '') => /^image\//.test(type) ? 'image' : /^video\//.test(type) ? 'video' : /^audio\//.test(type) ? 'audio'
  : /\.(png|jpe?g|gif|webp|heic)$/i.test(name) ? 'image' : /\.(mp4|mov|webm)$/i.test(name) ? 'video' : /\.(m4a|mp3|wav|ogg|webm)$/i.test(name) ? 'audio' : 'file';

export function sharedBoard({ baseUrl, departmentId, token, fetch: send = globalThis.fetch, onState = () => {}, names = id => id }) {
  const root = new URL('/api/departments/' + encodeURIComponent(departmentId) + '/', baseUrl).href;
  const headers = () => ({ Authorization: 'Bearer ' + token });
  let state = 'ready', lastError = null, lastGood = null;
  const settle = (next, error = null) => { state = next; lastError = error ? String(error.message || error) : null; onState({ state, lastError }); };

  const ask = async (path, options = {}) => {
    const response = await send(root + path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
    if (!response.ok) {
      const problem = new Error('the server answered ' + response.status);
      problem.status = response.status;
      throw problem;
    }
    return response;
  };

  return {
    shared: true,
    where: 'the department server',
    get state() { return state; },
    get lastError() { return lastError; },

    async list() {
      try {
        const posts = await (await ask('posts')).json();
        lastGood = posts.map(post => fromServerPost(post, names));
        settle('ready');
        return lastGood;
      } catch (error) {
        // A refusal and a dropped connection are different things. "I cannot reach the server" keeps what is
        // already on screen and marks it old. "You are not allowed" throws it away: somebody whose membership was
        // revoked should not keep reading the board from a copy, even a copy labelled stale.
        if ([401, 403, 404].includes(error.status)) { lastGood = null; settle('failed', error); return []; }
        settle(lastGood ? 'stale' : 'failed', error);
        return lastGood || [];
      }
    },

    async publish(post, files = [], record = {}) {
      settle('sending');
      const media = [];
      try {
        for (const [id, blob] of files) {
          const named = (post.media || []).find(item => item.id === id)?.name || blob.name || id;
          const uploaded = await (await ask('files?name=' + encodeURIComponent(named), { method: 'POST',
            headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob })).json();
          media.push(uploaded.id);
        }
        const extras = { ...(post.learning ? { learning: true } : {}), ...(post.inside ? { inside: true } : {}), ...(post.voice ? { voice: true } : {}),
          ...(post.when ? { when: post.when } : {}), ...(post.voice && post.media?.[0]?.seconds ? { seconds: post.media[0].seconds } : {}) };
        const body = JSON.stringify({ body: post.body || '', clientId: post.id, media, extras });
        const saved = await (await ask('posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
        settle('ready');
        return { ...fromServerPost(saved, names), duplicate: Boolean(saved.duplicate) };
      } catch (error) {
        // Whatever was uploaded before the failure is removed, so a retry does not leave orphans behind.
        for (const id of media) await ask('files/' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {});
        settle('unsent', error);
        throw error;
      }
    },

    async remove(postId) {
      try { await ask('posts/' + encodeURIComponent(postId), { method: 'DELETE' }); settle('ready'); }
      catch (error) { settle('unsent', error); throw error; }
    },

    async file(mediaId) {
      try { return await (await ask('files/' + encodeURIComponent(mediaId))).blob(); }
      catch { return null; }
    },

    // Deliberately nothing. Erasing this device does not erase the department.
    async clear() { return undefined; }
  };
}
