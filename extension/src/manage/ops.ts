import { jsonBytes, type Changes, type Snapshot } from '../git/repo';
import {
  EMOTE_CODE_RE,
  isValidEmoji,
  isValidNick,
  NAMEPLATE_EMOJI_MAX,
  PLATE_SYMBOLS_MAX,
  isValidPlateSymbols,
  type PlateAnim,
  type PlatePattern,
  type PlateShape,
  BadgeInfoSchema,
  type BadgeInfo,
  normalizeNick,
  SLUG_RE,
  paths,
  userKey,
  type Badge,
  type Emote,
  type Nameplate,
  type NameplateKind,
  type Paint,
  type Profile,
  type Platform,
  type UserCosmetics,
  NameplateSchema,
  PaintSchema,
  ProfileSchema,
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

export type Mutation = (snap: Snapshot) => Changes;

/** Несколько изменений одним коммитом (каждое видит исходный снимок — они должны писать разные файлы). */
export function combine(...mutations: Mutation[]): Mutation {
  return (snap) => {
    const out: Changes = new Map();
    for (const m of mutations) for (const [k, v] of m(snap)) out.set(k, v);
    return out;
  };
}

function findCodeCI(snap: Snapshot, code: string): string | undefined {
  const lower = code.toLowerCase();
  return Object.keys(snap.emotes).find((c) => c.toLowerCase() === lower);
}

/** Удаляет картинки, на которые больше никто не ссылается (с учётом уже внесённых изменений). */
function gcImages(snap: Snapshot, changes: Changes, removedImages: string[]): void {
  const used = new Set<string>();
  for (const e of Object.values(snap.emotes)) if (changes.get(paths.emote(e.code)) !== null) used.add(e.image);
  for (const b of Object.values(snap.badges)) if (changes.get(paths.badge(b.id)) !== null) used.add(b.image);
  for (const n of Object.values(snap.nameplates)) if (n.image && changes.get(paths.nameplate(n.id)) !== null) used.add(n.image);
  for (const [p, data] of changes) {
    if (data && (p.startsWith('emotes/') || p.startsWith('badges/') || p.startsWith('nameplates/'))) {
      const image = (JSON.parse(new TextDecoder().decode(data)) as { image?: string }).image;
      if (image) used.add(image);
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

export function addBadge(id: string, title: string, img: PreparedImage, author: string, description = ''): Mutation {
  if (!SLUG_RE.test(id)) throw new UserError('ID иконки: 2–32 символа, латиница в нижнем регистре, цифры и -');
  if (!title.trim()) throw new UserError('Укажите название иконки');
  const info = checkBadgeDescription(description);
  return (snap) => {
    if (snap.badges[id]) throw new UserError(`Иконка «${id}» уже есть`);
    const badge: Badge = { id, title: title.trim(), image: img.path, author };
    const changes: Changes = new Map([[paths.badge(id), jsonBytes(badge)]]);
    if (!(img.path in snap.images)) changes.set(img.path, img.bytes);
    // Осталось от удалённой иконки с тем же ID — заменяем
    if (info || snap.badgeInfo[id]) changes.set(paths.badgeInfo(id), info ? jsonBytes(info) : null);
    return changes;
  };
}

/** Чистит и проверяет описание иконки. Пустое — null. */
function checkBadgeDescription(description: string): BadgeInfo | null {
  const d = description.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!d) return null;
  const parsed = BadgeInfoSchema.safeParse({ description: d });
  if (!parsed.success) throw new UserError('Описание: до 200 символов, только текст');
  return parsed.data;
}

/** Меняет описание иконки (пустое — убирает). Поля будущих версий в файле описания сохраняются. */
export function setBadgeDescription(id: string, description: string): Mutation {
  const info = checkBadgeDescription(description);
  return (snap) => {
    if (!snap.badges[id]) throw new UserError(`Иконка «${id}» не найдена`);
    const current = snap.badgeInfo[id] ?? {};
    const next: BadgeInfo = info ? { ...current, ...info } : withoutKey(current, 'description');
    if (JSON.stringify(next) === JSON.stringify(current)) return new Map();
    const empty = Object.values(next).every((v) => v === undefined);
    return new Map([[paths.badgeInfo(id), empty ? null : jsonBytes(next)]]);
  };
}

/** Удаляет иконку и снимает её со всех пользователей. */
export function deleteBadge(id: string): Mutation {
  return (snap) => {
    const b = snap.badges[id];
    if (!b) return new Map();
    const changes: Changes = new Map([[paths.badge(id), null]]);
    if (snap.badgeInfo[id]) changes.set(paths.badgeInfo(id), null);
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

// ——— Подложки под ник ———

export interface NameplateInput {
  id: string;
  title: string;
  kind: NameplateKind;
  image?: PreparedImage;
  emoji?: string;
  opacity: number;
  /** Узоры и символы (новые виды). */
  pattern?: PlatePattern;
  symbols?: string;
  colors?: string[];
  glow?: number;
  anim?: PlateAnim;
  speed?: number;
  shape?: PlateShape;
  fade?: boolean;
  alt?: { color: string; pattern?: PlatePattern; checker?: boolean };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Создаёт подложку или (overwrite) меняет существующую узорную. Старые виды (эмодзи, картинка)
 * больше не создаются из интерфейса, но остаются в операции — их проверяют тесты и чтение.
 */
export function saveNameplate(input: NameplateInput, author: string, overwrite = false): Mutation {
  if (!SLUG_RE.test(input.id)) throw new UserError('ID подложки: 2–32 символа, латиница в нижнем регистре, цифры и -');
  if (!input.title.trim()) throw new UserError('Укажите название подложки');
  if (input.kind === 'image' && !input.image) throw new UserError('Выберите картинку');
  if (input.kind === 'emoji' && !isValidEmoji(input.emoji ?? '')) throw new UserError(`Только эмодзи, от 1 до ${NAMEPLATE_EMOJI_MAX}`);
  if (input.kind === 'symbols' && !isValidPlateSymbols(input.symbols ?? ''))
    throw new UserError(`Символы: от 1 до ${PLATE_SYMBOLS_MAX}, латиница, цифры, знаки и символы из палитры (без < > & " ')`);
  const plate: Nameplate = { id: input.id, title: input.title.trim(), kind: input.kind, opacity: round2(input.opacity), author };
  if (input.kind === 'image') plate.image = input.image!.path;
  else if (input.kind === 'emoji') plate.emoji = input.emoji!;
  else {
    if (input.kind === 'pattern') plate.pattern = input.pattern;
    else plate.symbols = input.symbols;
    plate.colors = input.colors;
    if (input.glow) plate.glow = round2(input.glow);
    if (input.anim && input.anim !== 'none') {
      plate.anim = input.anim;
      plate.speed = round2(input.speed ?? 4);
    }
    if (input.shape && input.shape !== 'fill') plate.shape = input.shape;
    if (input.fade) plate.fade = true;
    if (input.alt) {
      plate.alt = { color: input.alt.color };
      if (input.kind === 'pattern' && input.alt.pattern && input.alt.pattern !== input.pattern) plate.alt.pattern = input.alt.pattern;
      if (input.alt.checker) plate.alt.checker = true;
    }
  }
  const parsed = NameplateSchema.safeParse(plate);
  if (!parsed.success) throw new UserError('Некорректная подложка: ' + parsed.error.issues.map((i) => i.path.join('.') || i.message).join(', '));
  return (snap) => {
    const existing = snap.nameplates[input.id];
    if (existing && !overwrite) throw new UserError(`Подложка «${input.id}» уже есть`);
    if (existing && (existing.kind === 'image' || existing.kind === 'emoji' || plate.kind === 'image' || plate.kind === 'emoji'))
      throw new UserError('Менять можно только узоры и символы');
    const changes: Changes = new Map([[paths.nameplate(input.id), jsonBytes(parsed.data)]]);
    if (input.image && !(input.image.path in snap.images)) changes.set(input.image.path, input.image.bytes);
    return changes;
  };
}

export function addNameplate(input: NameplateInput, author: string): Mutation {
  return saveNameplate(input, author);
}

/** Удаляет подложку и снимает её со всех зрителей. */
export function deleteNameplate(id: string): Mutation {
  return (snap) => {
    const n = snap.nameplates[id];
    if (!n) return new Map();
    const changes: Changes = new Map([[paths.nameplate(id), null]]);
    for (const [key, p] of Object.entries(snap.profiles)) {
      if (p.nameplate === id) writeProfile(changes, key, withoutKey(p, 'nameplate'));
    }
    if (n.image) gcImages(snap, changes, [n.image]);
    return changes;
  };
}

function withoutKey<T extends object, K extends keyof T>(o: T, k: K): Omit<T, K> {
  const { [k]: _, ...rest } = o;
  return rest;
}

/** Профиль без полей — файл удаляется. Незнакомые поля (из будущих версий) сохраняются. */
function writeProfile(changes: Changes, key: string, p: Profile): void {
  const i = key.indexOf(':');
  const platform = key.slice(0, i) as Platform;
  const nick = key.slice(i + 1);
  // Только служебные поля (даты) — профиля по сути нет, файл удаляется
  const empty = Object.entries(p).every(([k, v]) => v === undefined || k === 'since' || k === 'updatedAt');
  changes.set(paths.profile(platform, nick), empty ? null : jsonBytes(p));
}

// ——— Профиль зрителя ———

/** То, что заполняется в форме профиля (подложка назначается отдельно — setNameplate). */
export interface ProfileInfo {
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
}

const INFO_FIELDS = [
  'about', 'pronouns', 'links', 'favEmotes', 'alsoOn', 'accent', 'status', 'birthday', 'timezone', 'interests', 'languages', 'updatedAt',
] as const;

const FIELD_TITLES: Record<string, string> = {
  about: 'о себе', pronouns: 'местоимения', links: 'ссылки', favEmotes: 'любимые смайлы', alsoOn: 'другая площадка', accent: 'цвет',
  status: 'статус', birthday: 'день рождения', timezone: 'часовой пояс', interests: 'интересы', languages: 'языки',
};

/** Убирает пустое: пустые строки, ссылки без адреса, пустые списки. */
export function cleanProfileInfo(info: ProfileInfo): ProfileInfo {
  const out: ProfileInfo = {};
  const about = info.about?.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (about) out.about = about;
  const pronouns = info.pronouns?.trim();
  if (pronouns) out.pronouns = pronouns;
  const links = (info.links ?? [])
    .map((l) => ({ title: l.title.trim(), url: l.url.trim() }))
    .filter((l) => l.url)
    .map((l) => ({ title: l.title || hostOf(l.url), url: l.url }));
  if (links.length) out.links = links;
  const favs = [...new Set((info.favEmotes ?? []).map((c) => c.trim()).filter(Boolean))];
  if (favs.length) out.favEmotes = favs;
  if (info.alsoOn?.nick.trim()) out.alsoOn = { platform: info.alsoOn.platform, nick: normalizeNick(info.alsoOn.nick) };
  if (info.accent) out.accent = info.accent.toLowerCase();
  const status = info.status?.trim();
  if (status) out.status = status;
  if (info.birthday) out.birthday = info.birthday;
  if (info.timezone) out.timezone = info.timezone;
  const interests = [...new Set((info.interests ?? []).map((t) => t.trim().replace(/\s+/g, ' ')).filter(Boolean))];
  if (interests.length) out.interests = interests;
  const languages = [...new Set(info.languages ?? [])];
  if (languages.length) out.languages = languages;
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Правка профиля: получает текущий профиль, возвращает новый. Может проверять ссылки по снимку. */
type ProfileEdit = (current: Profile, snap: Snapshot) => Profile;

function checkNick(platform: Platform, nick: string): string {
  const n = normalizeNick(nick);
  if (!isValidNick(platform, n)) throw new UserError(platform === 'twitch' ? 'Логин Twitch: латиница, цифры и _' : 'Некорректный ник VK Live');
  return n;
}

/**
 * Все правки профиля одного зрителя — одной записью файла (подложка и «о себе» живут в одном файле:
 * две отдельные мутации через combine затёрли бы друг друга). Ничего не изменилось — нет изменений.
 */
function editProfile(platform: Platform, nick: string, ...edits: ProfileEdit[]): Mutation {
  const n = checkNick(platform, nick);
  return (snap) => {
    const key = userKey(platform, n);
    const current = snap.profiles[key] ?? {};
    let next = edits.reduce((p, e) => e(p, snap), current);
    if (JSON.stringify(next) === JSON.stringify(current)) return new Map();
    // «В Owl Smile с…»: дата создания профиля (старым профилям без даты её не выдумываем)
    if (!snap.profiles[key] && !next.since) next = { ...next, since: new Date().toISOString() };
    const changes: Changes = new Map();
    writeProfile(changes, key, next);
    return changes;
  };
}

function nameplateEdit(nameplate: string | undefined): ProfileEdit {
  return (current, snap) => {
    if (nameplate && !snap.nameplates[nameplate]) throw new UserError(`Подложка «${nameplate}» не найдена`);
    if (current.nameplate === nameplate) return current;
    return nameplate ? { ...current, nameplate } : withoutKey(current, 'nameplate');
  };
}

function infoEdit(platform: Platform, nick: string, info: ProfileInfo): ProfileEdit {
  const clean = cleanProfileInfo(info);
  if (clean.alsoOn && clean.alsoOn.platform === platform && clean.alsoOn.nick === normalizeNick(nick))
    throw new UserError('«Также на» — это другая площадка или другой ник');
  const parsed = ProfileSchema.safeParse(clean);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => FIELD_TITLES[String(i.path[0])] ?? String(i.path[0])))];
    throw new UserError(`Проверьте: ${fields.join(', ')}` + (fields.includes('ссылки') ? ' (только https://)' : ''));
  }
  return (current, snap) => {
    for (const code of clean.favEmotes ?? []) if (!snap.emotes[code]) throw new UserError(`Смайла «${code}» нет в базе`);
    let rest: Profile = current;
    const before: Record<string, unknown> = {};
    for (const f of INFO_FIELDS) {
      if (f !== 'updatedAt' && current[f] !== undefined) before[f] = current[f];
      rest = withoutKey(rest, f);
    }
    // Те же данные — профиль не трогаем (и updatedAt не меняем)
    if (JSON.stringify(before) === JSON.stringify(clean)) return current;
    return Object.keys(clean).length ? { ...rest, ...parsed.data, updatedAt: new Date().toISOString() } : rest;
  };
}

/** Назначает нику подложку (undefined — снять). Остальной профиль не трогает. */
export function setNameplate(platform: Platform, nick: string, nameplate: string | undefined): Mutation {
  return editProfile(platform, nick, nameplateEdit(nameplate));
}

/**
 * Сохраняет «о себе», ссылки, любимые смайлы… Подложку и поля, которых эта версия не знает,
 * не трогает. Пустое — поля убираются (и файл, если в нём ничего не осталось).
 */
export function setProfileInfo(platform: Platform, nick: string, info: ProfileInfo): Mutation {
  return editProfile(platform, nick, infoEdit(platform, nick, info));
}

/** Подложка и профиль вместе (форма «Зрители»). */
export function setProfile(platform: Platform, nick: string, p: { nameplate: string | undefined; info: ProfileInfo }): Mutation {
  return editProfile(platform, nick, nameplateEdit(p.nameplate), infoEdit(platform, nick, p.info));
}
