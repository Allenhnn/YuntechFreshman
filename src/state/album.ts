/**
 * Phone photo album, kept in this browser's IndexedDB (photos are too big for localStorage).
 * Every call fails soft: without IndexedDB (private mode) the album is simply empty.
 */
export interface Photo {
  id: number;
  /** Real time taken (ms). */
  at: number;
  /** In-game time label, e.g. 第 3 天 12:46. */
  label: string;
  blob: Blob;
}

const DB = 'yfm-album';
const STORE = 'photos';

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function addPhoto(blob: Blob, label: string): Promise<void> {
  await run('readwrite', (s) => s.add({ at: Date.now(), label, blob }));
}

/** Newest first. */
export async function listPhotos(): Promise<Photo[]> {
  const all = (await run<Photo[]>('readonly', (s) => s.getAll() as IDBRequest<Photo[]>)) ?? [];
  return all.sort((a, b) => b.at - a.at);
}

export async function deletePhoto(id: number): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}
