import { z } from 'zod';
import {
  EMOTE_CODE_RE,
  HEX_COLOR_RE,
  IMAGE_PATH_RE,
  NAMEPLATE_KINDS,
  PLATE_ANIMS,
  PLATE_PATTERNS,
  PLATE_SHAPES,
  isValidPlateSymbols,
  PAINT_PRESETS,
  PLATFORMS,
  PROFILE_LIMITS,
  BADGE_DESCRIPTION_MAX,
  SLUG_RE,
  isSafeUrl,
  isValidBirthday,
  isValidTimeZone,
  PROFILE_LANGUAGES,
  isValidEmoji,
  isValidNick,
} from './ids';

export * from './ids';

const author = z.string().trim().min(1).max(40);

export const MetaSchema = z.strictObject({ schema: z.literal(1) });

export const EmoteSchema = z.strictObject({
  code: z.string().regex(EMOTE_CODE_RE),
  image: z.string().regex(IMAGE_PATH_RE),
  animated: z.boolean(),
  w: z.number().int().min(1).max(512),
  h: z.number().int().min(1).max(512),
  author,
  createdAt: z.string().max(40),
});
export type Emote = z.infer<typeof EmoteSchema>;

export const BadgeSchema = z.strictObject({
  id: z.string().regex(SLUG_RE),
  title: z.string().trim().min(1).max(60),
  image: z.string().regex(IMAGE_PATH_RE),
  author,
});
export type Badge = z.infer<typeof BadgeSchema>;

export const PaintSchema = z.strictObject({
  id: z.string().regex(SLUG_RE),
  title: z.string().trim().min(1).max(60),
  preset: z.enum(PAINT_PRESETS),
  colors: z.array(z.string().regex(HEX_COLOR_RE)).min(1).max(5),
  angle: z.number().int().min(0).max(360).optional(),
  /** Длительность цикла анимации, секунды. */
  speed: z.number().min(0.5).max(20).optional(),
});
export type Paint = z.infer<typeof PaintSchema>;

export const UserSchema = z.strictObject({
  badges: z.array(z.string().regex(SLUG_RE)).max(3),
  paint: z.string().regex(SLUG_RE).optional(),
});
export type UserCosmetics = z.infer<typeof UserSchema>;

/**
 * Подложка под ник: картинка (широкая полоса) или узор из эмодзи.
 * Не strict: незнакомые поля из будущих версий отбрасываются, а не делают файл невалидным.
 */
export const NameplateSchema = z
  .object({
    id: z.string().regex(SLUG_RE),
    title: z.string().trim().min(1).max(60),
    kind: z.enum(NAMEPLATE_KINDS),
    image: z.string().regex(IMAGE_PATH_RE).optional(),
    emoji: z.string().refine(isValidEmoji).optional(),
    /** Непрозрачность подложки: 0.15–1. */
    opacity: z.number().min(0.15).max(1).optional(),
    /** kind: pattern — готовый узор. */
    pattern: z.enum(PLATE_PATTERNS).optional(),
    /** kind: symbols — свои однотонные символы. */
    symbols: z.string().refine(isValidPlateSymbols).optional(),
    /** Цвет узора и необязательная подкраска фона. */
    colors: z.array(z.string().regex(HEX_COLOR_RE)).min(1).max(2).optional(),
    /** Свечение цветом узора: 0–1. */
    glow: z.number().min(0).max(1).optional(),
    anim: z.enum(PLATE_ANIMS).optional(),
    /** Длительность цикла анимации, секунды. */
    speed: z.number().min(0.5).max(20).optional(),
    shape: z.enum(PLATE_SHAPES).optional(),
    /** Растворять края. */
    fade: z.boolean().optional(),
    /**
     * Второй слой, чередуется с первым: «1-2-1-2» вдоль ника или шахматкой в два ряда (checker).
     * Свой цвет и (у узоров) свой узор — по умолчанию тот же.
     */
    alt: z
      .object({ color: z.string().regex(HEX_COLOR_RE), pattern: z.enum(PLATE_PATTERNS).optional(), checker: z.boolean().optional() })
      .optional(),
    author,
  })
  .refine(
    (p) => {
      const has = { image: Boolean(p.image), emoji: Boolean(p.emoji), pattern: Boolean(p.pattern), symbols: Boolean(p.symbols) };
      const only = (k: keyof typeof has) => Object.entries(has).every(([x, v]) => v === (x === k));
      if (p.kind === 'image' || p.kind === 'emoji') return only(p.kind);
      return only(p.kind) && Boolean(p.colors?.length);
    },
    { message: 'у подложки должно быть ровно то, что нужно её виду (картинка, эмодзи, узор или символы с цветом)' },
  );
export type Nameplate = z.infer<typeof NameplateSchema>;

/**
 * Профиль зрителя (profiles/<площадка>/<ник>.json). Свободная схема (looseObject): поля, которых эта
 * версия не знает, сохраняются при перезаписи файла — их добавят следующие версии (о себе, ссылки…).
 * Используются только проверенные известные поля.
 */
const L = PROFILE_LIMITS;
/** Текст без управляющих символов (кроме перевода строки в «о себе»). */
const plain = (max: number, multiline = false) =>
  z.string().trim().min(1).max(max).refine((s) => !(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(s));

/** Описание иконки (badges-info/<id>.json). Свободная схема — поля будущих версий сохраняются. */
export const BadgeInfoSchema = z.looseObject({
  description: plain(BADGE_DESCRIPTION_MAX, true).optional(),
});
export type BadgeInfo = z.infer<typeof BadgeInfoSchema>;

export const ProfileLinkSchema = z.object({
  title: plain(L.linkTitle),
  url: z.string().refine(isSafeUrl),
});

export const ProfileSchema = z.looseObject({
  nameplate: z.string().regex(SLUG_RE).optional(),
  /** О себе: только текст, переводы строк сохраняются. */
  about: plain(L.about, true).optional(),
  pronouns: plain(L.pronouns).optional(),
  links: z.array(ProfileLinkSchema).max(L.links).optional(),
  /** Любимые смайлы Owl Smile — коды. */
  favEmotes: z.array(z.string().regex(EMOTE_CODE_RE)).max(L.favEmotes).optional(),
  /** Тот же человек на другой площадке. */
  alsoOn: z
    .object({ platform: z.enum(PLATFORMS), nick: z.string().max(60) })
    .refine((a) => isValidNick(a.platform, a.nick))
    .optional(),
  /** Цвет шапки карточки. */
  accent: z.string().regex(HEX_COLOR_RE).optional(),
  /** Короткий статус: «играю в …». */
  status: plain(L.status).optional(),
  /** «MM-DD», без года. */
  birthday: z.string().refine(isValidBirthday).optional(),
  /** Часовой пояс IANA — для «у него сейчас 03:12». */
  timezone: z.string().refine(isValidTimeZone).optional(),
  interests: z.array(plain(L.interest)).max(L.interests).optional(),
  languages: z.array(z.enum(PROFILE_LANGUAGES)).max(L.languages).optional(),
  /** Когда профиль появился (ставится при первой записи). */
  since: z.string().max(40).optional(),
  updatedAt: z.string().max(40).optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;
