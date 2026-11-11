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
