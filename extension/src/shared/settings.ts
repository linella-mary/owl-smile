import { browser } from 'wxt/browser';
import { HEX_COLOR_RE, PLATFORMS, normalizeNick, type Platform } from './ids';

/**
 * Личные настройки отображения: видит только сам пользователь.
 * Хранятся в chrome.storage.sync (переезжают между браузерами пользователя) — по ключу на поле
 * (`owl:p:<поле>`), чтобы не упереться в лимит 8 КБ на ключ из-за списков слов и ников.
 * Без zod: модуль подключается в content scripts.
 */
export interface Settings {
  /** Главный выключатель: всё, что Owl Smile меняет в чате. */
  enabled: boolean;
  platforms: Record<Platform, boolean>;

  // Смайлы
  owlEmotes: boolean;
  bttvEmotes: boolean;
  /** Высота смайла в чате, px: Twitch и VK Live отдельно (у них разная высота строки). */
  emoteSize: number;
  emoteSizeVk: number;
  /** Анимированные смайлы: всегда / только при наведении / не двигаются. */
  animation: 'always' | 'hover' | 'off';
  /** Крупный смайл с кодом и источником при наведении. */
  hoverPreview: boolean;

  // Иконки и ники
  badges: boolean;
  badgeSize: number;
  badgeSizeVk: number;
  paints: boolean;
  paintAnimation: boolean;
  /** Подложки под ники (видны всем, у кого стоит Owl Smile). */
  nameplates: boolean;
  /** Профиль Owl по клику на ник оформленного зрителя. */
  profiles: boolean;

  // Вид сообщений
  /** Размер шрифта сообщений, px; 0 — как на площадке. */
  fontSize: number;
  /** Межстрочный интервал; 0 — как на площадке. */
  lineSpacing: number;
  zebra: boolean;
  separators: boolean;
  timestamps: boolean;
  /** Свой ник на площадках — для подсветки упоминаний. */
  myNicks: Record<Platform, string>;
  highlightMentions: boolean;
  highlightWords: string[];
  highlightUsers: string[];
  highlightColor: string;

  // Фильтры
  hideWords: string[];
  hideUsers: string[];
  hideBots: boolean;
  bots: string[];
  filterMode: 'hide' | 'collapse';

  // Окно смайлов
  pickerButton: boolean;
  /** Где кнопка 🦉: в панели под полем ввода или в самом поле, рядом со смайлами площадки. */
  pickerPlace: 'toolbar' | 'input';
  tabCompletion: boolean;
  recentCount: number;
  pickerEmoteSize: number;
  defaultTab: 'last' | 'owl' | 'bttv';
}

export const DEFAULT_BOTS = ['nightbot', 'streamelements', 'moobot', 'fossabot', 'streamlabs', 'wizebot', 'botrixoficial', 'sery_bot'];

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  platforms: { twitch: true, vk: true },
  owlEmotes: true,
  bttvEmotes: true,
  emoteSize: 28,
  emoteSizeVk: 32,
  animation: 'always',
  hoverPreview: true,
  badges: true,
  badgeSize: 18,
  badgeSizeVk: 20,
  paints: true,
  paintAnimation: true,
  nameplates: true,
  profiles: true,
  fontSize: 0,
  lineSpacing: 0,
  zebra: false,
  separators: false,
  timestamps: false,
  myNicks: { twitch: '', vk: '' },
  highlightMentions: true,
  highlightWords: [],
  highlightUsers: [],
  highlightColor: '#9147ff',
  hideWords: [],
  hideUsers: [],
  hideBots: false,
  bots: DEFAULT_BOTS,
  filterMode: 'collapse',
  pickerButton: true,
  pickerPlace: 'toolbar',
  tabCompletion: true,
  recentCount: 16,
  pickerEmoteSize: 28,
  defaultTab: 'last',
};

/** Границы числовых настроек: [min, max]. */
export const LIMITS = {
  emoteSize: [16, 64],
  emoteSizeVk: [16, 64],
  badgeSize: [12, 32],
  badgeSizeVk: [12, 32],
  fontSize: [0, 24],
  lineSpacing: [0, 2.5],
  recentCount: [0, 32],
  pickerEmoteSize: [20, 48],
} as const satisfies Partial<Record<keyof Settings, readonly [number, number]>>;

const MAX_LIST = 150;
const MAX_ITEM = 40;

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, [min, max]: readonly [number, number], d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const oneOf = <T extends string>(v: unknown, options: readonly T[], d: T): T => (options.includes(v as T) ? (v as T) : d);

/** Ник из настроек: как ключ зрителя, без «@» в начале. */
const nickOf = (x: string) => normalizeNick(normalizeNick(x).replace(/^@/, ''));

/** Список слов/ников: строки без пустых и повторов, обрезанные по длине и количеству. */
export function cleanList(v: unknown, nick = false): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const s = (nick ? nickOf(x) : x.trim().replace(/\s+/g, ' ')).slice(0, MAX_ITEM);
    if (s) out.add(s);
    if (out.size >= MAX_LIST) break;
  }
  return [...out];
}

/** Приводит что угодно (старые версии, импорт из файла, мусор) к корректным настройкам. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const rec = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  const platforms = rec(r.platforms);
  const nicks = rec(r.myNicks);
  const n = (k: keyof typeof LIMITS) => num(r[k], LIMITS[k], d[k]);
  return {
    enabled: bool(r.enabled, d.enabled),
    platforms: Object.fromEntries(PLATFORMS.map((p) => [p, bool(platforms[p], d.platforms[p])])) as Settings['platforms'],
    owlEmotes: bool(r.owlEmotes, d.owlEmotes),
    bttvEmotes: bool(r.bttvEmotes, d.bttvEmotes),
    emoteSize: n('emoteSize'),
    emoteSizeVk: n('emoteSizeVk'),
    animation: oneOf(r.animation, ['always', 'hover', 'off'], d.animation),
    hoverPreview: bool(r.hoverPreview, d.hoverPreview),
    badges: bool(r.badges, d.badges),
    badgeSize: n('badgeSize'),
    badgeSizeVk: n('badgeSizeVk'),
    paints: bool(r.paints, d.paints),
    paintAnimation: bool(r.paintAnimation, d.paintAnimation),
    nameplates: bool(r.nameplates, d.nameplates),
    profiles: bool(r.profiles, d.profiles),
    fontSize: n('fontSize'),
    lineSpacing: Math.round(n('lineSpacing') * 10) / 10,
    zebra: bool(r.zebra, d.zebra),
    separators: bool(r.separators, d.separators),
    timestamps: bool(r.timestamps, d.timestamps),
    myNicks: Object.fromEntries(
      PLATFORMS.map((p) => [p, typeof nicks[p] === 'string' ? nickOf(nicks[p] as string).slice(0, 60) : '']),
    ) as Settings['myNicks'],
    highlightMentions: bool(r.highlightMentions, d.highlightMentions),
    highlightWords: cleanList(r.highlightWords),
    highlightUsers: cleanList(r.highlightUsers, true),
    highlightColor: typeof r.highlightColor === 'string' && HEX_COLOR_RE.test(r.highlightColor) ? r.highlightColor : d.highlightColor,
    hideWords: cleanList(r.hideWords),
    hideUsers: cleanList(r.hideUsers, true),
    hideBots: bool(r.hideBots, d.hideBots),
    bots: Array.isArray(r.bots) ? cleanList(r.bots, true) : [...d.bots],
    filterMode: oneOf(r.filterMode, ['hide', 'collapse'], d.filterMode),
    pickerButton: bool(r.pickerButton, d.pickerButton),
    pickerPlace: oneOf(r.pickerPlace, ['toolbar', 'input'], d.pickerPlace),
    tabCompletion: bool(r.tabCompletion, d.tabCompletion),
    recentCount: Math.round(n('recentCount')),
    pickerEmoteSize: n('pickerEmoteSize'),
    defaultTab: oneOf(r.defaultTab, ['last', 'owl', 'bttv'], d.defaultTab),
  };
}

/** Owl Smile работает на этой площадке. */
export const isActive = (s: Settings, platform: Platform) => s.enabled && s.platforms[platform];

const PREFIX = 'owl:p:';
const FIELDS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
const storeKey = (f: keyof Settings) => PREFIX + f;
const sync = () => browser.storage.sync;

/** Собирает настройки из записей хранилища (`owl:p:<поле>` → значение). */
export function settingsFromStore(items: Record<string, unknown>): Settings {
  const raw: Record<string, unknown> = {};
  for (const f of FIELDS) if (storeKey(f) in items) raw[f] = items[storeKey(f)];
  return normalizeSettings(raw);
}

export async function loadSettings(): Promise<Settings> {
  try {
    return settingsFromStore(await sync().get(FIELDS.map(storeKey)));
  } catch {
    return normalizeSettings({});
  }
}

/** Сохраняет изменённые поля. Значения по умолчанию из хранилища удаляются — меньше места и записей. */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await loadSettings()), ...patch });
  const set: Record<string, unknown> = {};
  const remove: string[] = [];
  for (const f of Object.keys(patch) as (keyof Settings)[]) {
    if (!FIELDS.includes(f)) continue;
    if (JSON.stringify(next[f]) === JSON.stringify(DEFAULT_SETTINGS[f])) remove.push(storeKey(f));
    else set[storeKey(f)] = next[f];
  }
  if (Object.keys(set).length) await sync().set(set);
  if (remove.length) await sync().remove(remove);
  return next;
}

/** Сбросить всё к значениям по умолчанию. */
export async function resetSettings(): Promise<void> {
  await sync().remove(FIELDS.map(storeKey));
}

/** Подписка на изменения настроек (из любой вкладки и с других устройств). Возвращает отписку. */
export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, unknown>) => {
    if (Object.keys(changes).some((k) => k.startsWith(PREFIX))) void loadSettings().then(cb);
  };
  sync().onChanged.addListener(listener);
  return () => sync().onChanged.removeListener(listener);
}

/** Короткий отпечаток настроек — для пометки уже обработанных сообщений. */
export function settingsHash(s: Settings): string {
  const str = JSON.stringify(s);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
