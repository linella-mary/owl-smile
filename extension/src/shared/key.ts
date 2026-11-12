import { browser } from 'wxt/browser';

/** Ключ доступа на запись (токен развёртывания GitFlic). Хранится только у пользователя. */
const K_KEY = 'owl:key';

export async function getKey(): Promise<string> {
  return ((await browser.storage.local.get(K_KEY))[K_KEY] as string | undefined) ?? '';
}

export async function setKey(key: string): Promise<void> {
  await browser.storage.local.set({ [K_KEY]: key.trim() });
}

export async function clearKey(): Promise<void> {
  await browser.storage.local.remove(K_KEY);
}
