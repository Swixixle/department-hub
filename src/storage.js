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
