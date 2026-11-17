import { browser } from 'wxt/browser';

/**
 * Ключ доступа на запись (токен развёртывания GitFlic). Хранится только у пользователя.
 *
 * Лежит в IndexedDB расширения, а не в storage.local: storage.local читают и скрипты расширения
 * на страницах чата, и при взломе такой страницы ключ утёк бы вместе с правом менять всю базу.
 * IndexedDB расширения видна только его собственным страницам и фоновому скрипту.
 */
const DB = 'owl-key';
const STORE = 'key';
const ID = 'write';
/** Где ключ лежал до версии 0.6.1 — переносится при первом чтении. */
const LEGACY_KEY = 'owl:key';

function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => {
        resolve(req.result);
        db.close();
      };
      req.onerror = () => {
        reject(req.error);
        db.close();
      };
    };
  });
}

/** Переносит ключ из storage.local (старые версии) в IndexedDB. Вызывается и фоновым скриптом при обновлении. */
export async function migrateKey(): Promise<void> {
  const legacy = (await browser.storage.local.get(LEGACY_KEY))[LEGACY_KEY] as string | undefined;
  if (legacy === undefined) return;
  if (legacy && !(await idb('readonly', (s) => s.get(ID) as IDBRequest<string | undefined>))) await idb('readwrite', (s) => s.put(legacy, ID));
  await browser.storage.local.remove(LEGACY_KEY);
}

export async function getKey(): Promise<string> {
  await migrateKey();
  return (await idb('readonly', (s) => s.get(ID) as IDBRequest<string | undefined>)) ?? '';
}

export async function setKey(key: string): Promise<void> {
  await idb('readwrite', (s) => s.put(key.trim(), ID));
}

export async function clearKey(): Promise<void> {
  await idb('readwrite', (s) => s.delete(ID));
  await browser.storage.local.remove(LEGACY_KEY);
}

// ——— Личный ключ админа (см. shared/admin.ts) — там же, в IndexedDB ———
const ADMIN_ID = 'admin';

export async function getAdminKey(): Promise<string> {
  return (await idb('readonly', (s) => s.get(ADMIN_ID) as IDBRequest<string | undefined>)) ?? '';
}

export async function setAdminKey(key: string): Promise<void> {
  await idb('readwrite', (s) => s.put(key.trim(), ADMIN_ID));
}

export async function clearAdminKey(): Promise<void> {
  await idb('readwrite', (s) => s.delete(ADMIN_ID));
}
