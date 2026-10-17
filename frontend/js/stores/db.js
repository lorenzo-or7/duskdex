// Wrapper mínimo de IndexedDB com transações multi-store atômicas.
export const DB_NAME = 'duskdex-demo';
export const DB_VERSION = 1;
export const STORES = ['meta', 'cards', 'copies', 'locations', 'binders', 'decks', 'wishlist', 'batches', 'assets', 'activity', 'social'];

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('Este navegador não oferece IndexedDB; o uso sem conta precisa dele para salvar dados.')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: name === 'meta' || name === 'social' ? 'key' : (name === 'cards' ? 'key' : 'id') });
          if (name === 'copies') { store.createIndex('cardKey', 'cardKey'); store.createIndex('locationId', 'locationId'); }
          if (name === 'batches') store.createIndex('createdAt', 'createdAt');
          if (name === 'activity') store.createIndex('at', 'at');
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('Falha ao abrir o banco local.'));
    req.onblocked = () => reject(new Error('O banco local está bloqueado por outra aba. Feche-a e tente de novo.'));
  });
  return dbPromise;
}

const promisify = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

/**
 * Executa `fn(stores)` em uma única transação. Se qualquer passo lançar erro, tudo é desfeito (abort).
 * `stores` expõe get/getAll/put/del/clear por store, todos retornando Promises dentro da mesma transação.
 */
export async function tx(storeNames, mode, fn) {
  const db = await openDB();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode);
    let result; let failed = null;
    const api = {};
    for (const n of names) {
      const s = t.objectStore(n);
      api[n] = {
        get: (k) => promisify(s.get(k)),
        getAll: () => promisify(s.getAll()),
        put: (v) => promisify(s.put(v)),
        del: (k) => promisify(s.delete(k)),
        clear: () => promisify(s.clear()),
        byIndex: (idx, v) => promisify(s.index(idx).getAll(v)),
      };
    }
    t.oncomplete = () => (failed ? reject(failed) : resolve(result));
    t.onerror = () => reject(failed || t.error);
    t.onabort = () => reject(failed || t.error || new Error('Operação cancelada.'));
    Promise.resolve().then(() => fn(api)).then((r) => { result = r; }).catch((e) => {
      failed = e;
      try { t.abort(); } catch { /* já finalizada */ }
    });
  });
}

export const getAll = (store) => tx(store, 'readonly', (s) => s[store].getAll());
export const get = (store, key) => tx(store, 'readonly', (s) => s[store].get(key));
export const put = (store, value) => tx(store, 'readwrite', (s) => s[store].put(value));
export const del = (store, key) => tx(store, 'readwrite', (s) => s[store].del(key));

export async function wipe() {
  const db = await openDB();
  await new Promise((res, rej) => {
    const t = db.transaction(STORES, 'readwrite');
    STORES.forEach((n) => t.objectStore(n).clear());
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}
