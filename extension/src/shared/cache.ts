import { browser } from 'wxt/browser';
import type { NameplateKind, PlateAnim, PlatePattern, PlateShape, Platform } from './ids';
import type { Paint, UserCosmetics } from './schema';

/**
 * Локальный кэш в chrome.storage.local (с unlimitedStorage).
 * Content scripts читают его напрямую и в сеть не ходят.
 *   owl:index   — индекс данных (без картинок)
 *   owl:status  — состояние синхронизации
 *   owl:imgs    — список oid сохранённых картинок
 *   img:<oid>   — картинка как data: URL (oid git-блоба, неизменяем)
 */
export interface LocalIndex {
  head: string;
  syncedAt: number;
  emotes: Record<string, { img: string; animated: boolean; w: number; h: number; author: string; createdAt?: string }>;
  badges: Record<string, { img: string; title: string; description?: string }>;
  paints: Record<string, Paint>;
  users: Record<string, UserCosmetics>;
  /** Нет в кэше, сохранённом версиями до подложек (до первой синхронизации после обновления). */
  nameplates?: Record<string, LocalNameplate>;
  /** Только известные поля профиля. */
  profiles?: Record<string, LocalProfile>;
}

export interface LocalNameplate {
  title: string;
  kind: NameplateKind;
  /** oid картинки (kind: image). */
  img?: string;
  emoji?: string;
  opacity?: number;
  pattern?: PlatePattern;
  symbols?: string;
  colors?: string[];
  glow?: number;
  anim?: PlateAnim;
  speed?: number;
  shape?: PlateShape;
  fade?: boolean;
  alt?: PlateAlt;
}

/** Второй слой подложки (чередование «1-2-1-2» или шахматка). */
export interface PlateAlt {
  color: string;
  pattern?: PlatePattern;
  checker?: boolean;
}

/** Поля подложки, которые переносятся из репозитория в кэш как есть (уже проверены схемой). */
export const NAMEPLATE_STYLE_FIELDS = ['emoji', 'opacity', 'pattern', 'symbols', 'colors', 'glow', 'anim', 'speed', 'shape', 'fade', 'alt'] as const satisfies readonly (keyof LocalNameplate)[];

export interface LocalProfile {
  nameplate?: string;
  about?: string;
  pronouns?: string;
  links?: { title: string; url: string }[];
  favEmotes?: string[];
  alsoOn?: { platform: Platform; nick: string };
  accent?: string;
  status?: string;
  birthday?: string;
  timezone?: string;
  interests?: string[];
  languages?: string[];
  since?: string;
}

/** Поля профиля, которые эта версия знает и показывает. */
export const PROFILE_FIELDS = [
  'nameplate', 'about', 'pronouns', 'links', 'favEmotes', 'alsoOn', 'accent', 'status', 'birthday', 'timezone', 'interests', 'languages', 'since',
] as const satisfies readonly (keyof LocalProfile)[];

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error';
  at: number;
  error?: string;
  head?: string;
}

export const K_INDEX = 'owl:index';
export const K_STATUS = 'owl:status';
const K_IMGS = 'owl:imgs';
export const imgKey = (oid: string) => `img:${oid}`;

const local = () => browser.storage.local;

export async function getIndex(): Promise<LocalIndex | null> {
  return ((await local().get(K_INDEX))[K_INDEX] as LocalIndex | undefined) ?? null;
}

export async function getStatus(): Promise<SyncStatus | null> {
  return ((await local().get(K_STATUS))[K_STATUS] as SyncStatus | undefined) ?? null;
}

export async function setStatus(s: SyncStatus): Promise<void> {
  await local().set({ [K_STATUS]: s });
}

export async function getStoredImageOids(): Promise<string[]> {
  return ((await local().get(K_IMGS))[K_IMGS] as string[] | undefined) ?? [];
}

/** Сохраняет новые картинки, индекс и удаляет неиспользуемые картинки. */
export async function commitIndex(index: LocalIndex, newImages: Record<string, string>, keep: Set<string>): Promise<void> {
  const stored = await getStoredImageOids();
  const entries = Object.fromEntries(Object.entries(newImages).map(([oid, url]) => [imgKey(oid), url]));
  if (Object.keys(entries).length) await local().set(entries);
  await local().set({ [K_INDEX]: index, [K_IMGS]: [...keep] });
  const stale = stored.filter((oid) => !keep.has(oid)).map(imgKey);
  if (stale.length) await local().remove(stale);
}

export async function getImages(oids: string[]): Promise<Record<string, string>> {
  if (!oids.length) return {};
  const raw = await local().get(oids.map(imgKey));
  const out: Record<string, string> = {};
  for (const oid of oids) {
    const v = raw[imgKey(oid)];
    if (typeof v === 'string') out[oid] = v;
  }
  return out;
}
