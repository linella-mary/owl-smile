/** Константы и ID без зависимостей (используются и в content scripts — без zod). */

/** Код смайла — то, что пишут в чат. Регистр учитывается. */
export const EMOTE_CODE_RE = /^[A-Za-z0-9_]{3,25}$/;
/** ID иконки / эффекта — короткий slug. */
export const SLUG_RE = /^[a-z0-9-]{2,32}$/;
/** Ник на площадке (в нижнем регистре). */
export const NICK_RE = /^[a-z0-9_.\-]{1,40}$/;
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
  return `${platform}:${nick.toLowerCase()}`;
}

/** Пути файлов в репозитории данных. */
export const paths = {
  meta: 'meta.json',
  emote: (code: string) => `emotes/${code}.json`,
  badge: (id: string) => `badges/${id}.json`,
  paint: (id: string) => `paints/${id}.json`,
  user: (platform: Platform, nick: string) => `users/${platform}/${nick.toLowerCase()}.json`,
};

/** Код целиком из строчных букв — похож на обычное слово (например «ok»). */
export function isRiskyCode(code: string): boolean {
  return /^[a-z]+$/.test(code);
}
