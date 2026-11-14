/**
 * Смайлы BetterTTV: глобальные и смайлы Twitch-канала.
 *
 * Локально хранятся только списки (код → id картинки), несколько КБ. Картинки браузер грузит
 * с cdn.betterttv.net, когда смайл виден, и кэширует их сам (CDN отдаёт max-age полгода).
 * Заранее картинки не качаются: у большого канала это 12–30 МБ, в основном анимация (замер 14.11.2026).
 *
 * Хранилище (chrome.storage.local):
 *   bttv:global        — глобальные смайлы { at, emotes, error? }
 *   bttv:ch:<логин>    — смайлы канала { login, name, id, at, usedAt, emotes, error? }
 *   bttv:channels      — логины сохранённых каналов (лишние удаляются, см. MAX_CHANNELS)
 *   bttv:channel       — Twitch-канал из настроек: его смайлы показываются на VK Live
 *
 * API BetterTTV знает каналы только по числовому id Twitch. Id по логину даёт открытый сервис
 * api.ivr.fi (туда уходит только логин канала).
 */

export interface BttvEmote {
  id: string;
  code: string;
  animated: boolean;
  w?: number;
  h?: number;
  /** Кто загрузил на BetterTTV (у общих смайлов канала; у своих смайлов канала — сам канал). */
  by?: string;
}

export interface BttvGlobal {
  at: number;
  emotes: BttvEmote[];
  error?: string;
}

export interface BttvChannel {
  login: string;
  /** Отображаемое имя канала. */
  name: string;
  /** Числовой id Twitch; null — ещё не узнали. */
  id: string | null;
  /** Когда список последний раз успешно обновлён (0 — ни разу). */
  at: number;
  /** Когда канал последний раз открывали — по нему удаляются старые каналы. */
  usedAt: number;
  emotes: BttvEmote[];
  /** Последняя ошибка (список при этом — от прошлого успешного обновления). */
  error?: string;
  /** У канала нет страницы на BetterTTV — смайлов нет, это не ошибка. */
  missing?: boolean;
}

export const K_BTTV_GLOBAL = 'bttv:global';
export const K_BTTV_CHANNELS = 'bttv:channels';
export const K_BTTV_SETTING = 'bttv:channel';
export const bttvChannelKey = (login: string) => `bttv:ch:${login}`;

/** Списки обновляются не чаще раза в 15 минут — как и база Owl Smile. */
export const BTTV_TTL_MS = 15 * 60 * 1000;
/** Сколько каналов держать (на Twitch каждый открытый канал сохраняется). */
export const MAX_CHANNELS = 8;

const TEST_HOST: string | undefined = import.meta.env?.WXT_BTTV_TEST_HOST || undefined;
export const BTTV_API = TEST_HOST ?? 'https://api.betterttv.net';
export const IVR_API = TEST_HOST ?? 'https://api.ivr.fi';
export const BTTV_CDN = TEST_HOST ?? 'https://cdn.betterttv.net';

export const bttvImg = (id: string, size: 1 | 2 | 3) => `${BTTV_CDN}/emote/${id}/${size}x.webp`;
/** srcset: на обычном экране — маленькая картинка, на чётком — вдвое больше. */
export const bttvSrcset = (id: string) => `${bttvImg(id, 1)} 1x, ${bttvImg(id, 2)} 2x`;

const LOGIN_RE = /^[a-z0-9_]{1,25}$/;
const ID_RE = /^[0-9a-f]{24}$/;

/**
 * Логин Twitch из того, что ввёл человек: «Forsen», «@forsen», «twitch.tv/forsen», «https://www.twitch.tv/forsen/videos».
 * null — не похоже на логин.
 */
export function normalizeLogin(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  const url = /(?:^|\/\/|\.)twitch\.tv\/(?:popout\/|embed\/|moderator\/)?([^/?#\s]+)/.exec(s);
  if (url) s = url[1]!;
  s = s.replace(/^@/, '');
  return LOGIN_RE.test(s) ? s : null;
}

/** Первые части адреса на twitch.tv, которые не являются каналом. */
const NOT_CHANNEL = new Set([
  'directory', 'videos', 'settings', 'subscriptions', 'inventory', 'wallet', 'drops', 'search', 'downloads',
  'turbo', 'prime', 'jobs', 'p', 'store', 'friends', 'messages', 'following', 'login', 'signup', 'logout',
  'payments', 'bits', 'collections', 'clips', 'products', 'broadcast', 'team', 'creatorcamp', 'privacy', 'legal',
]);

/** Канал, открытый на странице Twitch (null — страница без канала: каталог, запись по ссылке /videos/…). */
export function twitchChannelFromUrl(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (!/(^|\.)twitch\.tv$/.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p).toLowerCase());
  if (u.hostname.startsWith('dashboard.')) {
    // dashboard.twitch.tv/u/<логин>/stream-manager
    return parts[0] === 'u' && parts[1] && LOGIN_RE.test(parts[1]) ? parts[1] : null;
  }
  let login = parts[0];
  if (login === 'popout' || login === 'embed' || login === 'moderator') login = parts[1];
  if (!login || NOT_CHANNEL.has(login) || !LOGIN_RE.test(login)) return null;
  return login;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const dim = (v: unknown) => (typeof v === 'number' && v > 0 && v < 1000 ? Math.round(v) : undefined);

/**
 * Список смайлов из ответа BetterTTV. Пропускаются модификаторы (c!, h! — у BetterTTV это не смайлы,
 * а команды для соседнего смайла), записи без id или с пробелами в коде; повтор кода — первый выигрывает.
 */
export function parseEmotes(list: unknown): BttvEmote[] {
  if (!Array.isArray(list)) return [];
  const out: BttvEmote[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    if (!isObj(e) || e.modifier === true) continue;
    const { id, code } = e;
    if (typeof id !== 'string' || !ID_RE.test(id)) continue;
    if (typeof code !== 'string' || !code || code.length > 100 || /\s/.test(code) || seen.has(code)) continue;
    seen.add(code);
    const item: BttvEmote = { id, code, animated: e.animated === true };
    const user = isObj(e.user) ? e.user : null;
    const by = user && (typeof user.displayName === 'string' && user.displayName ? user.displayName : user.name);
    if (typeof by === 'string' && by.length <= 40 && !/[\u0000-\u001f\u007f]/.test(by)) item.by = by;
    const w = dim(e.width);
    const h = dim(e.height);
    if (w && h) Object.assign(item, { w, h });
    out.push(item);
  }
  return out;
}

/** Ответ /3/cached/users/twitch/<id>: свои смайлы канала и общие (shared), свои — первыми. */
export function parseChannel(body: unknown): BttvEmote[] {
  if (!isObj(body)) return [];
  const own = Array.isArray(body.channelEmotes) ? body.channelEmotes : [];
  const shared = Array.isArray(body.sharedEmotes) ? body.sharedEmotes : [];
  return parseEmotes([...own, ...shared]);
}

/** Ответ api.ivr.fi /v2/twitch/user?login=…: { id, name } или null, если канала нет. */
export function parseIvrUser(body: unknown, login: string): { id: string; name: string } | null {
  if (!Array.isArray(body)) return null;
  const u = body.find((x) => isObj(x) && typeof x.login === 'string' && x.login.toLowerCase() === login);
  if (!isObj(u) || typeof u.id !== 'string' || !/^\d{1,20}$/.test(u.id)) return null;
  return { id: u.id, name: typeof u.displayName === 'string' && u.displayName ? u.displayName : login };
}

// ── Обновление списков (фоновый скрипт) ──

export interface BttvStore {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface BttvDeps {
  store: BttvStore;
  fetch: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`${new URL(url).host} ответил ${status}`);
  }
}

const describe = (e: unknown) =>
  e instanceof HttpError ? e.message : e instanceof Error && e.name === 'TimeoutError' ? 'нет ответа' : e instanceof Error ? e.message : String(e);

export function createBttvSync({ store, fetch: doFetch, now = Date.now, timeoutMs = 15000 }: BttvDeps) {
  const running = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    let p = running.get(key) as Promise<T> | undefined;
    if (!p) {
      p = fn().finally(() => running.delete(key));
      running.set(key, p);
    }
    return p;
  };

  async function getJson(url: string): Promise<unknown> {
    const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new HttpError(res.status, url);
    return res.json();
  }

  async function read<T>(key: string): Promise<T | undefined> {
    return (await store.get([key]))[key] as T | undefined;
  }

  /** Глобальные смайлы; при ошибке сети остаётся прошлый список. */
  function refreshGlobal(force = false): Promise<BttvGlobal> {
    return once(K_BTTV_GLOBAL, async () => {
      const prev = await read<BttvGlobal>(K_BTTV_GLOBAL);
      if (!force && prev && !prev.error && now() - prev.at < BTTV_TTL_MS) return prev;
      let next: BttvGlobal;
      try {
        next = { at: now(), emotes: parseEmotes(await getJson(`${BTTV_API}/3/cached/emotes/global`)) };
      } catch (e) {
        next = { at: prev?.at ?? 0, emotes: prev?.emotes ?? [], error: describe(e) };
      }
      await store.set({ [K_BTTV_GLOBAL]: next });
      return next;
    });
  }

  /** Смайлы канала по логину. Не устарели — только отмечает, что канал открывали. */
  function refreshChannel(login: string, force = false): Promise<BttvChannel | null> {
    const clean = normalizeLogin(login);
    if (!clean) return Promise.resolve(null);
    const key = bttvChannelKey(clean);
    return once(key, async () => {
      const prev = await read<BttvChannel>(key);
      const base: BttvChannel = prev ?? { login: clean, name: clean, id: null, at: 0, usedAt: 0, emotes: [] };
      const fresh = prev && !prev.error && now() - prev.at < BTTV_TTL_MS;
      let next: BttvChannel;
      if (fresh && !force) {
        // Отметку «открывали» обновляем не чаще раза в час: каждая запись будит все вкладки чата
        if (now() - base.usedAt < 60 * 60 * 1000) return base;
        next = { ...base, usedAt: now() };
      } else {
        next = await download(base);
      }
      await store.set({ [key]: next });
      await remember(clean);
      return next;
    });
  }

  async function download(base: BttvChannel): Promise<BttvChannel> {
    const stamp = { usedAt: now() };
    let { id, name } = base;
    try {
      if (!id) {
        const user = parseIvrUser(await getJson(`${IVR_API}/v2/twitch/user?login=${encodeURIComponent(base.login)}`), base.login);
        if (!user) return { ...base, ...stamp, at: 0, emotes: [], error: 'такого канала на Twitch нет' };
        ({ id, name } = user);
      }
      try {
        const emotes = parseChannel(await getJson(`${BTTV_API}/3/cached/users/twitch/${id}`));
        return { login: base.login, name, id, at: now(), ...stamp, emotes };
      } catch (e) {
        // 404 — канал не заходил на BetterTTV: смайлов нет, это нормально
        if (e instanceof HttpError && e.status === 404) return { login: base.login, name, id, at: now(), ...stamp, emotes: [], missing: true };
        throw e;
      }
    } catch (e) {
      return { ...base, id, name, ...stamp, error: describe(e) };
    }
  }

  /** Список сохранённых каналов: свежий — первым, лишние (кроме канала из настроек) удаляются. */
  async function remember(login: string): Promise<void> {
    const got = await store.get([K_BTTV_CHANNELS, K_BTTV_SETTING]);
    const list = [login, ...((got[K_BTTV_CHANNELS] as string[] | undefined) ?? []).filter((l) => l !== login)];
    const pinned = got[K_BTTV_SETTING] as string | undefined;
    const keep = list.slice(0, MAX_CHANNELS);
    if (pinned && list.includes(pinned) && !keep.includes(pinned)) keep[keep.length - 1] = pinned;
    const drop = list.filter((l) => !keep.includes(l));
    await store.set({ [K_BTTV_CHANNELS]: keep });
    if (drop.length) await store.remove(drop.map(bttvChannelKey));
  }

  /** Канал из настроек (для VK Live): сохранить и сразу загрузить. Пусто — убрать. */
  async function setSettingChannel(raw: string): Promise<{ ok: boolean; login: string | null; error?: string }> {
    if (!raw.trim()) {
      await store.remove([K_BTTV_SETTING]);
      return { ok: true, login: null };
    }
    const login = normalizeLogin(raw);
    if (!login) return { ok: false, login: null, error: 'Это не похоже на Twitch-канал: нужен логин, например forsen' };
    await store.set({ [K_BTTV_SETTING]: login });
    const ch = await refreshChannel(login, true);
    return ch?.error ? { ok: false, login, error: ch.error } : { ok: true, login };
  }

  /** Периодическое обновление: глобальные и канал из настроек. */
  async function refreshAll(): Promise<void> {
    await refreshGlobal();
    const pinned = await read<string>(K_BTTV_SETTING);
    if (pinned) await refreshChannel(pinned);
  }

  return { refreshGlobal, refreshChannel, setSettingChannel, refreshAll };
}
