// ───────────────────────────── Project database ─────────────────────────────
// Project bodies live in IndexedDB: no 5 MB localStorage cap, and objects are stored by structured
// clone instead of JSON text, so imported music, recorded voices and images do not break saving.
import type { Project } from '../types';

const DB_NAME = 'sticky-motion', STORE = 'projects';
const LS_PROJECT_PREFIX = 'sticky-motion:project:';

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbPromise = null; rej(r.error); };
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(d => new Promise<T>((res, rej) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => res(req.result);
    tx.onerror = tx.onabort = () => rej(tx.error ?? req.error);
  }));
}

export const getProject = (id: string) => run<Project | undefined>('readonly', s => s.get(id));
export const putProject = (p: Project) => run('readwrite', s => s.put(p)).then(() => undefined);
export const removeProject = (id: string) => run('readwrite', s => s.delete(id)).then(() => undefined);

/** Move projects saved by older versions out of localStorage. */
export async function migrateFromLocalStorage() {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(LS_PROJECT_PREFIX));
  for (const k of keys) {
    try { const p = JSON.parse(localStorage.getItem(k)!); if (p?.id) await putProject(p); localStorage.removeItem(k); }
    catch (e) { console.warn('could not migrate', k, e); }
  }
}
