import { unzipSync } from 'fflate';
import { mimeByPath, toDataUrl } from '../shared/bytes';
import type { LocalIndex } from '../shared/cache';
import { buildIndex, snapshotFromFiles, type FileSource } from '../shared/snapshot';

/**
 * База Owl Smile из zip-архива GitFlic (тот, что скачивает плагин OBS):
 * те же проверки и тот же индекс, что у расширения, только без git.
 * id картинки — её путь в базе (img/<sha16>.ext): он уже уникален по содержимому.
 */
export async function indexFromZip(zip: Uint8Array, head: string): Promise<{ index: LocalIndex; images: Record<string, string>; problems: string[] }> {
  const files = unzipSync(zip);
  const dirs = new Map<string, { name: string; id: string }[]>();
  for (const path of Object.keys(files)) {
    if (path.endsWith('/')) continue; // записи каталогов
    const i = path.lastIndexOf('/');
    const dir = i < 0 ? '' : path.slice(0, i);
    const list = dirs.get(dir) ?? [];
    list.push({ name: path.slice(i + 1), id: path });
    dirs.set(dir, list);
  }
  const src: FileSource = {
    list: async (dir) => dirs.get(dir) ?? [],
    read: async (id) => files[id]!,
  };
  const snap = await snapshotFromFiles(head, src);
  const { index, need } = buildIndex(snap, Date.now());
  const images: Record<string, string> = {};
  for (const [id, path] of need) images[id] = toDataUrl(files[id]!, mimeByPath(path));
  return { index, images, problems: snap.problems };
}

/** Короткий отпечаток архива — вместо хеша коммита (по нему видно, что база поменялась). */
export async function zipHead(zip: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', zip as Uint8Array<ArrayBuffer>));
  return [...digest.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
