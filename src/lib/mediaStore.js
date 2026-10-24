// Tiny IndexedDB blob store for Director Mode audio (voice-over, music) and
// assembled films: too large for localStorage, and must survive reloads.
const DB_NAME = 'director_media';
const STORE = 'blobs';

function open() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => { db.close(); resolve(req?.result); };
        t.onerror = () => { db.close(); reject(t.error); };
    });
}

export const putBlob = (key, blob) => tx('readwrite', s => s.put(blob, key));
export const getBlob = (key) => tx('readonly', s => s.get(key));
export const deleteBlob = (key) => tx('readwrite', s => s.delete(key));

export async function deleteByPrefix(prefix) {
    const db = await open();
    return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
        t.objectStore(STORE).delete(range);
        t.oncomplete = () => { db.close(); resolve(); };
        t.onerror = () => { db.close(); reject(t.error); };
    });
}
