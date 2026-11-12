/** Константы и ID без зависимостей (используются и в content scripts — без zod). */

/** Код смайла — то, что пишут в чат. Регистр учитывается. */
export const EMOTE_CODE_RE = /^[A-Za-z0-9_]{3,25}$/;
/** ID иконки / эффекта — короткий slug. */
export const SLUG_RE = /^[a-z0-9-]{2,32}$/;
/**
 * Ник на площадке после normalizeNick (в нижнем регистре).
 *  Twitch — логин: латиница, цифры, _.
 *  VK Live — отображаемое имя: любые буквы, цифры, пробел, _ . - # (например «данил кузнецов.», «ник#2949245»).
 *  Символы, запрещённые в именах файлов (/ \ : * ? " < > |), не допускаются — ник становится именем файла.
 */
export const NICK_RES = {
  twitch: /^[a-z0-9_]{1,25}$/,
  vk: /^[\p{L}\p{N}][\p{L}\p{N} _.\-#]{0,59}$/u,
} as const;

export function isValidNick(platform: Platform, nick: string): boolean {
  return NICK_RES[platform].test(nick);
}

/** Приводит ник к ключу: без пробелов по краям, без «:» в конце (VK), схлопнутые пробелы, нижний регистр. */
export function normalizeNick(raw: string): string {
  return raw.replace(/:\s*$/, '').trim().replace(/\s+/g, ' ').toLowerCase();
}
/** Путь к картинке в репозитории: img/<16 hex>.webp|gif */
export const IMAGE_PATH_RE = /^img\/[0-9a-f]{16}\.(webp|gif)$/;
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const PLATFORMS = ['twitch', 'vk'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_TITLES: Record<Platform, string> = { twitch: 'Twitch', vk: 'VK Live' };

export const PAINT_PRESETS = ['solid', 'gradient', 'shimmer', 'glow', 'flicker', 'rainbow'] as const;
export type PaintPreset = (typeof PAINT_PRESETS)[number];

/** Ключ пользователя: "twitch:login" / "vk:nick". */
export function userKey(platform: Platform, nick: string): string {
  return `${platform}:${normalizeNick(nick)}`;
}

/** Пути файлов в репозитории данных. */
export const paths = {
  meta: 'meta.json',
  emote: (code: string) => `emotes/${code}.json`,
  badge: (id: string) => `badges/${id}.json`,
  paint: (id: string) => `paints/${id}.json`,
  user: (platform: Platform, nick: string) => `users/${platform}/${normalizeNick(nick)}.json`,
};

/** Код целиком из строчных букв — похож на обычное слово (например «ok»). */
export function isRiskyCode(code: string): boolean {
  return /^[a-z]+$/.test(code);
}
