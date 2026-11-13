// The handoff's own store on this phone: one report and its boxed-out photos. Separate from the workspace on purpose,
// so a backup, a receipt, the activity log and the shared server never see it. Wiping deletes the whole database.
import { HANDOFF_DB, expired } from './handoff.js';

const STORES = ['report', 'photos'];
const opened = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(HANDOFF_DB, 1);
  request.onupgradeneeded = () => { for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name); };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
// A database left empty (opened by something else after a wipe) is deleted and made again with its stores.
async function open() {
  const db = await opened();
  if (STORES.every(name => db.objectStoreNames.contains(name))) return db;
  db.close(); await wipeHandoff(); return opened();
}
const run = async (store, mode, work) => {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode), request = work(tx.objectStore(store));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
};

// Reads the report. One that has run past its 13 hours is wiped here, before anything shows it.
export async function loadHandoff(now = Date.now()) {
  const report = await run('report', 'readonly', store => store.get('current'));
  if (report && expired(report, now)) { await wipeHandoff(); return { report: null, wiped: true }; }
  return { report: report || null, wiped: false };
}
export const saveHandoff = report => run('report', 'readwrite', store => store.put(report, 'current'));
export const putHandoffPhoto = (id, blob) => run('photos', 'readwrite', store => store.put(blob, id));
export const getHandoffPhoto = id => run('photos', 'readonly', store => store.get(id));
export const dropHandoffPhoto = id => run('photos', 'readwrite', store => store.delete(id));
export const wipeHandoff = () => new Promise(resolve => {
  const request = indexedDB.deleteDatabase(HANDOFF_DB);
  request.onsuccess = request.onerror = request.onblocked = () => resolve();
});
