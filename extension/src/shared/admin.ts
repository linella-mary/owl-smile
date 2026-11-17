import { admin, adminEnabled } from './config';

/** SHA-256 строки в hex. */
export async function sha256Hex(s: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Подходит ли личный ключ админа (сверка с отпечатком из сборки). */
export async function isAdminKey(key: string): Promise<boolean> {
  return adminEnabled() && Boolean(key.trim()) && (await sha256Hex(key.trim())) === admin.keySha256;
}

/** Ник админа из сборки — сравнение без учёта регистра и пробелов по краям. */
export const isAdminNick = (nick: string) => nick.trim().toLowerCase() === admin.nick.toLowerCase();
