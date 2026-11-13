const sourceDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('department-hub-sources-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('images');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function sourceOperation(mode, work) {
  const db = await sourceDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('images', mode);
      const request = work(tx.objectStore('images'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export const putSource = (key, file, size) => sourceOperation('readwrite', store => store.put({ file, ...size }, key));
export const getSource = key => sourceOperation('readonly', store => store.get(key));
export const clearSources = () => sourceOperation('readwrite', store => store.clear());

export function loadState(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch { return fallback; }
}
export const saveState = (key, value) => localStorage.setItem(key, JSON.stringify(value));

// Files attached to board posts (pictures, video, recordings, documents), kept in this browser.
const mediaDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('department-hub-media-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function mediaOperation(mode, work) {
  const db = await mediaDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('files', mode);
      const request = work(tx.objectStore('files'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export const putMedia = (id, blob) => mediaOperation('readwrite', store => store.put(blob, id));
export const getMedia = id => mediaOperation('readonly', store => store.get(id));
export const deleteMedia = id => mediaOperation('readwrite', store => store.delete(id));
export const clearMedia = () => mediaOperation('readwrite', store => store.clear());

// Posts waiting for a signal: made on the shared board while the server could not be reached. Each entry keeps the
// post, its files (as the files themselves) and whose and which department's it is, so it is only ever sent under
// the same person's sign-in. Kept until it arrives or the person cancels it.
const outboxDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('department-hub-outbox-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('posts', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function outboxOperation(mode, work) {
  const db = await outboxDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('posts', mode);
      const request = work(tx.objectStore('posts'));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export const putOutbox = entry => outboxOperation('readwrite', store => store.put(entry));
export const listOutbox = async () => ((await outboxOperation('readonly', store => store.getAll())) || []).sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)));
export const deleteOutbox = id => outboxOperation('readwrite', store => store.delete(id));
