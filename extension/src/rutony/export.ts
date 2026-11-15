import { browser } from 'wxt/browser';
import { canResizeAnimation, resizeAnimation } from '../manage/animated';
import { IMAGE_LIMITS } from '../manage/image';
import { getImages, getIndex, type LocalIndex } from '../shared/cache';
import { buildZip, nextManifest, planExport, type RutonyFile, type RutonyManifest } from '../shared/rutony';

/**
 * Выгрузка смайлов в каталог «своих смайлов» RutonyChat.
 * Работает со страницы настроек: доступ к папке (File System Access API) просит только клик пользователя.
 */

/**
 * Какие форматы отдаём RutonyChat.
 *   compat   — PNG для статичных, GIF для анимированных (понимает любая программа);
 *   original — как в базе (WebP / GIF).
 */
export type RutonyFormat = 'compat' | 'original';
export const RUTONY_FORMAT: RutonyFormat = 'compat';

// ——— Типы File System Access API, которых нет в lib.dom ———

type PermissionMode = { mode: 'read' | 'readwrite' };
interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission(d: PermissionMode): Promise<PermissionState>;
  requestPermission(d: PermissionMode): Promise<PermissionState>;
}
type PickerWindow = Window & { showDirectoryPicker?: (o?: { id?: string; mode?: 'readwrite' }) => Promise<DirHandle> };

export const canPickFolder = (): boolean => typeof (window as PickerWindow).showDirectoryPicker === 'function';

// ——— Где храним выбор ———

/** Что выгружено в выбранную папку. Папку саму хранить в storage нельзя — она в IndexedDB. */
const K_RUTONY = 'owl:rutony';
const DB = 'owl-rutony';
const STORE = 'handles';
const HANDLE_KEY = 'folder';

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

export const loadFolder = (): Promise<DirHandle | undefined> => idb('readonly', (s) => s.get(HANDLE_KEY) as IDBRequest<DirHandle | undefined>);

async function loadManifest(): Promise<RutonyManifest> {
  return ((await browser.storage.local.get(K_RUTONY))[K_RUTONY] as RutonyManifest | undefined) ?? {};
}
const saveManifest = (m: RutonyManifest) => browser.storage.local.set({ [K_RUTONY]: m });

/** Окно выбора папки. Если выбрана другая папка — забываем, что выгружали в старую. */
export async function pickFolder(): Promise<DirHandle> {
  const handle = await (window as PickerWindow).showDirectoryPicker!({ id: 'owl-rutony', mode: 'readwrite' });
  const old = await loadFolder().catch(() => undefined);
  if (!old || !(await old.isSameEntry(handle))) await saveManifest({});
  await idb('readwrite', (s) => s.put(handle, HANDLE_KEY));
  return handle;
}

// ——— Картинки ———

function parseDataUrl(url: string): { mime: string; bytes: Uint8Array } {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(url);
  if (!m) throw new Error('Картинка в кэше повреждена');
  const bin = atob(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1]!, bytes };
}

const animatedWebpToGif = () => RUTONY_FORMAT === 'compat' && canResizeAnimation();

/** Расширение файла. Считается без перекодирования, чтобы сравнить с тем, что уже лежит в папке. */
function extFor(mime: string, animated: boolean): string {
  if (mime === 'image/gif') return 'gif';
  if (RUTONY_FORMAT === 'original') return 'webp';
  if (!animated) return 'png';
  return animatedWebpToGif() ? 'gif' : 'webp';
}

async function convert(mime: string, bytes: Uint8Array, animated: boolean, h: number): Promise<Uint8Array> {
  const ext = extFor(mime, animated);
  if (mime === 'image/gif' || ext === 'webp') return bytes;
  if (ext === 'gif') return (await resizeAnimation(bytes, mime, h, IMAGE_LIMITS.maxFrames)).bytes;
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } finally {
    bitmap.close();
  }
}

interface Source {
  files: RutonyFile[];
  /** Готовые байты файла (перекодируются только те, что нужно записать). */
  bytes(f: RutonyFile): Promise<Uint8Array>;
  /** Анимированный WebP, который браузер не смог превратить в GIF. */
  keptWebp: string[];
}

async function loadSource(): Promise<Source> {
  const index: LocalIndex | null = await getIndex();
  if (!index || !Object.keys(index.emotes).length) throw new Error('Смайлов ещё нет: нажмите 🦉 на панели браузера → «Синхронизировать»');
  const emotes = Object.entries(index.emotes);
  const images = await getImages([...new Set(emotes.map(([, e]) => e.img))]);

  const files: RutonyFile[] = [];
  const meta = new Map<string, { url: string; animated: boolean; h: number; mime: string }>();
  const keptWebp: string[] = [];
  for (const [code, e] of emotes.sort(([a], [b]) => a.localeCompare(b))) {
    const url = images[e.img];
    if (!url) continue;
    const mime = /^data:([^;,]+)/.exec(url)?.[1] ?? '';
    const name = `${code}.${extFor(mime, e.animated)}`;
    if (mime === 'image/webp' && e.animated && name.endsWith('.webp') && RUTONY_FORMAT === 'compat') keptWebp.push(code);
    files.push({ name, code, oid: e.img });
    meta.set(name, { url, animated: e.animated, h: e.h, mime });
  }
  return {
    files,
    keptWebp,
    async bytes(f) {
      const m = meta.get(f.name)!;
      const { bytes } = parseDataUrl(m.url);
      return convert(m.mime, bytes, m.animated, m.h);
    },
  };
}

// ——— Выгрузка ———

export interface ExportResult {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  /** Коды, которые не выгружены: в папке уже есть чужой файл с таким именем. */
  skipped: string[];
  /** Коды, которые не удалось записать. */
  failed: string[];
  keptWebp: string[];
}

/** Выгружает смайлы в папку. Файлы, которые положил сам стример, не трогает. */
export async function exportToFolder(handle: DirHandle): Promise<ExportResult> {
  if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
    throw new Error('Браузер не дал доступ к папке. Нажмите ещё раз и разрешите изменения');
  }
  const src = await loadSource();
  const existing: string[] = [];
  for await (const entry of handle.values()) if (entry.kind === 'file') existing.push(entry.name);

  const prev = await loadManifest();
  const plan = planExport(src.files, prev, existing);
  const prevNames = new Set(Object.keys(prev).map((n) => n.toLowerCase()));

  for (const name of plan.remove) {
    await handle.removeEntry(name).catch(() => {});
  }
  const written: RutonyFile[] = [];
  const failed: string[] = [];
  let added = 0;
  for (const f of plan.write) {
    try {
      const bytes = await src.bytes(f);
      const w = await (await handle.getFileHandle(f.name, { create: true })).createWritable();
      await w.write(bytes as Uint8Array<ArrayBuffer>);
      await w.close();
      written.push(f);
      if (!prevNames.has(f.name.toLowerCase())) added++;
    } catch {
      failed.push(f.code);
    }
  }
  await saveManifest(nextManifest(plan, written));

  return {
    added,
    updated: written.length - added,
    removed: plan.remove.filter((n) => !plan.write.some((f) => f.name.toLowerCase() === n.toLowerCase())).length,
    unchanged: plan.unchanged.length,
    skipped: plan.skipped.map((f) => f.code),
    failed,
    keptWebp: src.keptWebp,
  };
}

/** Все смайлы одним zip — для Firefox и на случай, если доступ к папке не дали. */
export async function downloadZip(): Promise<number> {
  const src = await loadSource();
  const files = [];
  for (const f of src.files) files.push({ name: f.name, bytes: await src.bytes(f) });
  const url = URL.createObjectURL(new Blob([buildZip(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'owl-smile-rutonychat.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return files.length;
}
