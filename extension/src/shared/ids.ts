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
/**
 * Эмодзи подложки: только символы-эмодзи (с ZWJ, вариантами и цветом кожи), без букв, цифр и знаков —
 * строка попадает в SVG-узор (см. core/paint.ts). Число эмодзи ограничивает NAMEPLATE_EMOJI_MAX.
 */
export const EMOJI_RE = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200D\uFE0F]{1,48}$/u;
export const NAMEPLATE_EMOJI_MAX = 6;

/** Эмодзи по одному (с учётом составных: 👩‍💻, флаги). */
export function splitEmoji(s: string): string[] {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment);
}

export function isValidEmoji(s: string): boolean {
  if (!EMOJI_RE.test(s)) return false;
  const parts = splitEmoji(s);
  return parts.length >= 1 && parts.length <= NAMEPLATE_EMOJI_MAX && parts.every((p) => /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(p));
}

/**
 * Ссылка из профиля: только https, без логина/пароля в адресе, до 200 символов.
 * Показывается как <a rel="noopener noreferrer">, но и так никаких javascript:/data:.
 */
export function isSafeUrl(s: string): boolean {
  if (s.length > 200) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !u.username && !u.password && Boolean(u.hostname) && u.href === s;
  } catch {
    return false;
  }
}

/** Описание иконки: что она значит, за что дают. */
export const BADGE_DESCRIPTION_MAX = 200;

/** Ограничения профиля (схема, форма и карточка). */
export const PROFILE_LIMITS = {
  about: 300, pronouns: 20, links: 5, linkTitle: 40, favEmotes: 8, status: 60, interests: 5, interest: 24, languages: 5,
} as const;

/** Языки для профиля (ISO 639-1) — короткий список, названия даёт Intl.DisplayNames. */
export const PROFILE_LANGUAGES = ['ru', 'en', 'uk', 'be', 'kk', 'uz', 'hy', 'ka', 'az', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'cs', 'tr', 'ja', 'ko', 'zh', 'ar', 'he', 'fi', 'sv'] as const;

/** День рождения «MM-DD» (без года), с проверкой числа дней в месяце (29 февраля можно). */
export function isValidBirthday(s: string): boolean {
  const m = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(s);
  if (!m) return false;
  const d = new Date(2024, Number(m[1]) - 1, Number(m[2]));
  return d.getMonth() === Number(m[1]) - 1;
}

/** Сегодня (по местному времени) день рождения «MM-DD». */
export function isBirthdayToday(birthday: string | undefined, now = new Date()): boolean {
  if (!birthday) return false;
  const today = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return birthday === today;
}

/** Часовой пояс IANA («Europe/Moscow»), который знает браузер. */
export function isValidTimeZone(s: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+){0,2}$/.test(s) || s.length > 40) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: s });
    return true;
  } catch {
    return false;
  }
}

/** Виды подложек. image и emoji — старые (только показ и удаление), новые — pattern и symbols. */
export const NAMEPLATE_KINDS = ['image', 'emoji', 'pattern', 'symbols'] as const;
export type NameplateKind = (typeof NAMEPLATE_KINDS)[number];

/** Готовые узоры подложек (векторные, рисуются в core/paint.ts patternTile). */
export const PLATE_PATTERNS = [
  'slash', 'backslash', 'dots', 'grid', 'lines', 'zigzag', 'lightning', 'waves', 'chevrons', 'stars', 'hearts', 'sparkles', 'diamonds', 'cross',
] as const;
export type PlatePattern = (typeof PLATE_PATTERNS)[number];
/** Форма: за ником, плашка, полоса под ником, светящаяся рамка. */
export const PLATE_SHAPES = ['fill', 'pill', 'underline', 'frame'] as const;
export type PlateShape = (typeof PLATE_SHAPES)[number];
export const PLATE_ANIMS = ['none', 'slide', 'pulse', 'shimmer', 'flicker'] as const;
export type PlateAnim = (typeof PLATE_ANIMS)[number];

/** Символы для узора «свои символы»: однотонные знаки (рисуются текстом одним цветом). */
export const PLATE_SYMBOL_PALETTE =
  '⚡✦✧★☆✶✷✹❖◆◇◈●○◉▲△▼▽►◄♦♥♡♠♣♪♫✿❀❄❅☾☽☀✚✛✕✖✗〰≈≋∿†‡§•·°※⁂░▒▓│║═╳╱╲⟡≡∞✱✲✺✸⌁';
export const PLATE_SYMBOLS_MAX = 8;
/**
 * Печатный ASCII без < > & " ' ` (строка попадает в SVG) и знаки из палитры. Пробел — промежуток.
 * Варианты начертания (U+FE0E/FE0F) вводить не нужно — однотонность ставит отрисовка.
 */
const PLATE_SYMBOL_RE = new RegExp(`^[ !#$%()*+,\\-./0-9:;=?@A-Z\\[\\\\\\]^_a-z{|}~${PLATE_SYMBOL_PALETTE}]+$`, 'u');

export function isValidPlateSymbols(s: string): boolean {
  const chars = [...s];
  return chars.length >= 1 && chars.length <= PLATE_SYMBOLS_MAX && PLATE_SYMBOL_RE.test(s) && s.trim().length > 0;
}

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
  /**
   * Описание иконки — отдельным файлом: у badges/ строгая схема, и старые версии отбросили бы
   * иконку с новым полем целиком. badges-info/ они просто не читают.
   */
  badgeInfo: (id: string) => `badges-info/${id}.json`,
  paint: (id: string) => `paints/${id}.json`,
  user: (platform: Platform, nick: string) => `users/${platform}/${normalizeNick(nick)}.json`,
  nameplate: (id: string) => `nameplates/${id}.json`,
  /** Профиль зрителя: подложка (и дальше — «о себе», ссылки…). Отдельно от users/ — старые версии его не читают. */
  profile: (platform: Platform, nick: string) => `profiles/${platform}/${normalizeNick(nick)}.json`,
};

/** Код целиком из строчных букв — похож на обычное слово (например «ok»). */
export function isRiskyCode(code: string): boolean {
  return /^[a-z]+$/.test(code);
}
