import type { ZodType } from 'zod';
import { NAMEPLATE_STYLE_FIELDS, PROFILE_FIELDS, type LocalIndex, type LocalProfile } from './cache';
import {
  BadgeInfoSchema,
  BadgeSchema,
  EmoteSchema,
  NameplateSchema,
  PaintSchema,
  PLATFORMS,
  ProfileSchema,
  SLUG_RE,
  UserSchema,
  isValidNick,
  normalizeNick,
  userKey,
  type Badge,
  type BadgeInfo,
  type Emote,
  type Nameplate,
  type Paint,
  type Profile,
  type UserCosmetics,
} from './schema';

/**
 * Разбор базы (emotes/, badges/, … img/) в снимок — одинаково для git (расширение)
 * и для zip-архива (плагин OBS). Здесь нет git, чтобы бандл для OBS оставался маленьким.
 */

/** Снимок данных репозитория на конкретном коммите. */
export interface Snapshot {
  head: string;
  emotes: Record<string, Emote>;
  badges: Record<string, Badge>;
  /** Описания иконок (badges-info/). */
  badgeInfo: Record<string, BadgeInfo>;
  paints: Record<string, Paint>;
  /** Ключ — "twitch:login" / "vk:nick". */
  users: Record<string, UserCosmetics>;
  nameplates: Record<string, Nameplate>;
  /** Ключ — "twitch:login" / "vk:nick". Незнакомые поля из будущих версий сохраняются как есть. */
  profiles: Record<string, Profile>;
  /** Путь картинки ("img/....webp") → id файла (oid git-блоба или путь в архиве). */
  images: Record<string, string>;
  /** Файлы, не прошедшие проверку (пропущены). */
  problems: string[];
}

/** Файлы базы: список файлов каталога (без подкаталогов) и чтение файла по id. */
export interface FileSource {
  list(dir: string): Promise<{ name: string; id: string }[]>;
  read(id: string): Promise<Uint8Array>;
}

const dec = new TextDecoder();

async function readJsonDir<T>(
  src: FileSource,
  dirPath: string,
  schema: ZodType<T>,
  problems: string[],
  check: (name: string, value: T) => boolean,
): Promise<Array<[string, T]>> {
  const out: Array<[string, T]> = [];
  for (const e of await src.list(dirPath)) {
    if (!e.name.endsWith('.json')) continue;
    const name = e.name.slice(0, -5);
    const file = `${dirPath}/${e.name}`;
    try {
      const parsed = schema.safeParse(JSON.parse(dec.decode(await src.read(e.id))));
      if (parsed.success && check(name, parsed.data)) out.push([name, parsed.data]);
      else problems.push(file);
    } catch {
      problems.push(file);
    }
  }
  return out;
}

/** Читает все данные базы. Невалидные файлы пропускаются и попадают в `problems`. */
export async function snapshotFromFiles(head: string, src: FileSource): Promise<Snapshot> {
  const problems: string[] = [];
  const snap: Snapshot = { head, emotes: {}, badges: {}, badgeInfo: {}, paints: {}, users: {}, nameplates: {}, profiles: {}, images: {}, problems };

  for (const e of await src.list('img')) snap.images[`img/${e.name}`] = e.id;
  const hasImage = (p: string) => p in snap.images;

  for (const [, v] of await readJsonDir(src, 'emotes', EmoteSchema, problems, (n, v) => n === v.code && hasImage(v.image)))
    snap.emotes[v.code] = v;
  for (const [, v] of await readJsonDir(src, 'badges', BadgeSchema, problems, (n, v) => n === v.id && hasImage(v.image)))
    snap.badges[v.id] = v;
  for (const [id, v] of await readJsonDir(src, 'badges-info', BadgeInfoSchema, problems, (n) => SLUG_RE.test(n)))
    snap.badgeInfo[id] = v;
  for (const [, v] of await readJsonDir(src, 'paints', PaintSchema, problems, (n, v) => n === v.id))
    snap.paints[v.id] = v;
  for (const platform of PLATFORMS) {
    for (const [nick, v] of await readJsonDir(src, `users/${platform}`, UserSchema, problems, (n) => n === normalizeNick(n) && isValidNick(platform, n)))
      snap.users[userKey(platform, nick)] = v;
    for (const [nick, v] of await readJsonDir(src, `profiles/${platform}`, ProfileSchema, problems, (n) => n === normalizeNick(n) && isValidNick(platform, n)))
      snap.profiles[userKey(platform, nick)] = v;
  }
  for (const [, v] of await readJsonDir(src, 'nameplates', NameplateSchema, problems, (n, v) => n === v.id && (!v.image || hasImage(v.image))))
    snap.nameplates[v.id] = v;
  return snap;
}

/**
 * Локальный индекс (то, что читают content scripts) из снимка.
 * `need` — какие картинки нужны: id картинки → путь в базе (по пути видно тип файла).
 */
export function buildIndex(snap: Snapshot, syncedAt: number): { index: LocalIndex; need: Map<string, string> } {
  const index: LocalIndex = { head: snap.head, syncedAt, emotes: {}, badges: {}, paints: snap.paints, users: snap.users, nameplates: {}, profiles: {} };
  const need = new Map<string, string>();
  for (const e of Object.values(snap.emotes)) {
    const id = snap.images[e.image]!;
    need.set(id, e.image);
    index.emotes[e.code] = { img: id, animated: e.animated, w: e.w, h: e.h, author: e.author, createdAt: e.createdAt };
  }
  for (const b of Object.values(snap.badges)) {
    const id = snap.images[b.image]!;
    need.set(id, b.image);
    index.badges[b.id] = { img: id, title: b.title };
    const description = snap.badgeInfo[b.id]?.description;
    if (description) index.badges[b.id]!.description = description;
  }
  for (const n of Object.values(snap.nameplates)) {
    const plate: NonNullable<LocalIndex['nameplates']>[string] = { title: n.title, kind: n.kind };
    if (n.image) {
      plate.img = snap.images[n.image]!;
      need.set(plate.img, n.image);
    }
    for (const f of NAMEPLATE_STYLE_FIELDS) if (n[f] !== undefined) (plate as unknown as Record<string, unknown>)[f] = n[f];
    index.nameplates![n.id] = plate;
  }
  for (const [key, p] of Object.entries(snap.profiles)) {
    // Только известные поля: незнакомое из будущих версий в чат не попадает
    const known: LocalProfile = {};
    for (const f of PROFILE_FIELDS) if (p[f] !== undefined) (known as Record<string, unknown>)[f] = p[f];
    if (Object.keys(known).length) index.profiles![key] = known;
  }
  return { index, need };
}
