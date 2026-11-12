import { z } from 'zod';
import { EMOTE_CODE_RE, HEX_COLOR_RE, IMAGE_PATH_RE, PAINT_PRESETS, SLUG_RE } from './ids';

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
