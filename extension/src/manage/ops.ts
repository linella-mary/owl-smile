import { jsonBytes, type Changes, type Snapshot } from '../git/repo';
import {
  EMOTE_CODE_RE,
  isValidNick,
  normalizeNick,
  SLUG_RE,
  paths,
  userKey,
  type Badge,
  type Emote,
  type Paint,
  type Platform,
  type UserCosmetics,
  PaintSchema,
} from '../shared/schema';

/** Картинка, подготовленная к загрузке (см. image.ts). */
export interface PreparedImage {
  bytes: Uint8Array;
  /** "img/<sha16>.webp|gif" */
  path: string;
  w: number;
  h: number;
  animated: boolean;
}

export class UserError extends Error {}

type Mutation = (snap: Snapshot) => Changes;

function findCodeCI(snap: Snapshot, code: string): string | undefined {
  const lower = code.toLowerCase();
  return Object.keys(snap.emotes).find((c) => c.toLowerCase() === lower);
}

/** Удаляет картинки, на которые больше никто не ссылается (с учётом уже внесённых изменений). */
function gcImages(snap: Snapshot, changes: Changes, removedImages: string[]): void {
  const used = new Set<string>();
  for (const e of Object.values(snap.emotes)) if (changes.get(paths.emote(e.code)) !== null) used.add(e.image);
  for (const b of Object.values(snap.badges)) if (changes.get(paths.badge(b.id)) !== null) used.add(b.image);
  for (const [p, data] of changes) {
    if (data && (p.startsWith('emotes/') || p.startsWith('badges/'))) {
      used.add((JSON.parse(new TextDecoder().decode(data)) as { image: string }).image);
    }
  }
  for (const img of removedImages) if (!used.has(img) && img in snap.images) changes.set(img, null);
}

function checkCode(code: string): void {
  if (!EMOTE_CODE_RE.test(code)) throw new UserError('Код: 3–25 символов, только латиница, цифры и _');
}

export function addEmote(code: string, img: PreparedImage, author: string): Mutation {
  checkCode(code);
  return (snap) => {
    const taken = findCodeCI(snap, code);
    if (taken) throw new UserError(`Код «${taken}» уже занят`);
    const emote: Emote = {
      code,
      image: img.path,
      animated: img.animated,
      w: img.w,
      h: img.h,
      author,
      createdAt: new Date().toISOString(),
    };
    const changes: Changes = new Map([[paths.emote(code), jsonBytes(emote)]]);
    if (!(img.path in snap.images)) changes.set(img.path, img.bytes);
    return changes;
  };
}

export function renameEmote(from: string, to: string): Mutation {
  checkCode(to);
  return (snap) => {
    const e = snap.emotes[from];
    if (!e) throw new UserError(`Смайл «${from}» не найден`);
    const taken = findCodeCI(snap, to);
    if (taken && taken !== from) throw new UserError(`Код «${taken}» уже занят`);
    return new Map([
      [paths.emote(from), null],
      [paths.emote(to), jsonBytes({ ...e, code: to })],
    ]);
  };
}

export function deleteEmote(code: string): Mutation {
  return (snap) => {
    const e = snap.emotes[code];
    if (!e) return new Map();
    const changes: Changes = new Map([[paths.emote(code), null]]);
    gcImages(snap, changes, [e.image]);
    return changes;
  };
}

export function addBadge(id: string, title: string, img: PreparedImage, author: string): Mutation {
  if (!SLUG_RE.test(id)) throw new UserError('ID иконки: 2–32 символа, латиница в нижнем регистре, цифры и -');
  if (!title.trim()) throw new UserError('Укажите название иконки');
  return (snap) => {
    if (snap.badges[id]) throw new UserError(`Иконка «${id}» уже есть`);
    const badge: Badge = { id, title: title.trim(), image: img.path, author };
    const changes: Changes = new Map([[paths.badge(id), jsonBytes(badge)]]);
    if (!(img.path in snap.images)) changes.set(img.path, img.bytes);
    return changes;
  };
}

/** Удаляет иконку и снимает её со всех пользователей. */
export function deleteBadge(id: string): Mutation {
  return (snap) => {
    const b = snap.badges[id];
    if (!b) return new Map();
    const changes: Changes = new Map([[paths.badge(id), null]]);
    for (const [key, u] of Object.entries(snap.users)) {
      if (u.badges.includes(id)) writeUser(changes, key, { ...u, badges: u.badges.filter((x) => x !== id) });
    }
    gcImages(snap, changes, [b.image]);
    return changes;
  };
}

export function savePaint(paint: Paint): Mutation {
  const parsed = PaintSchema.safeParse(paint);
  if (!parsed.success) throw new UserError('Некорректный эффект: ' + parsed.error.issues.map((i) => i.path.join('.')).join(', '));
  return () => new Map([[paths.paint(paint.id), jsonBytes(parsed.data)]]);
}

export function deletePaint(id: string): Mutation {
  return (snap) => {
    const changes: Changes = new Map([[paths.paint(id), null]]);
    for (const [key, u] of Object.entries(snap.users)) {
      if (u.paint === id) writeUser(changes, key, { badges: u.badges });
    }
    return changes;
  };
}

function writeUser(changes: Changes, key: string, u: UserCosmetics): void {
  const i = key.indexOf(':');
  const platform = key.slice(0, i) as Platform;
  const nick = key.slice(i + 1);
  const empty = !u.badges.length && !u.paint;
  changes.set(paths.user(platform, nick), empty ? null : jsonBytes(u));
}

/** Назначает иконки и эффект нику. Пустое оформление удаляет файл пользователя. */
export function setUser(platform: Platform, nick: string, cosmetics: UserCosmetics): Mutation {
  const n = normalizeNick(nick);
  if (!isValidNick(platform, n)) throw new UserError(platform === 'twitch' ? 'Логин Twitch: латиница, цифры и _' : 'Некорректный ник VK Live');
  if (cosmetics.badges.length > 3) throw new UserError('Не больше 3 иконок');
  return (snap) => {
    for (const b of cosmetics.badges) if (!snap.badges[b]) throw new UserError(`Иконка «${b}» не найдена`);
    if (cosmetics.paint && !snap.paints[cosmetics.paint]) throw new UserError(`Эффект «${cosmetics.paint}» не найден`);
    const changes: Changes = new Map();
    const u: UserCosmetics = { badges: cosmetics.badges };
    if (cosmetics.paint) u.paint = cosmetics.paint;
    writeUser(changes, userKey(platform, n), u);
    return changes;
  };
}
