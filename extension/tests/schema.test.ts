import { describe, expect, it } from 'vitest';
import { BadgeInfoSchema, EmoteSchema, NameplateSchema, PaintSchema, ProfileSchema, UserSchema, isRiskyCode, isValidEmoji } from '../src/shared/schema';

const emote = {
  code: 'CatJam',
  image: 'img/0123456789abcdef.webp',
  animated: false,
  w: 112,
  h: 112,
  author: 'owl',
  createdAt: '2026-11-12T10:00:00.000Z',
};

describe('схемы', () => {
  it('принимает корректный смайл', () => {
    expect(EmoteSchema.safeParse(emote).success).toBe(true);
  });

  it('отклоняет плохой код, путь вне img/ и лишние поля', () => {
    expect(EmoteSchema.safeParse({ ...emote, code: 'a b' }).success).toBe(false);
    expect(EmoteSchema.safeParse({ ...emote, image: '../evil.svg' }).success).toBe(false);
    expect(EmoteSchema.safeParse({ ...emote, image: 'img/0123456789abcdef.svg' }).success).toBe(false);
    expect(EmoteSchema.safeParse({ ...emote, onload: 'x' }).success).toBe(false);
  });

  it('эффект ника: только #RRGGBB, никакого CSS', () => {
    const paint = { id: 'gold', title: 'Золото', preset: 'gradient', colors: ['#ffcc00', '#ff8800'] };
    expect(PaintSchema.safeParse(paint).success).toBe(true);
    expect(PaintSchema.safeParse({ ...paint, colors: ['red;background:url(x)'] }).success).toBe(false);
    expect(PaintSchema.safeParse({ ...paint, preset: 'custom' }).success).toBe(false);
  });

  it('пользователь: не больше 3 иконок', () => {
    expect(UserSchema.safeParse({ badges: ['a1', 'b2', 'c3', 'd4'] }).success).toBe(false);
  });

  it('предупреждение про частые слова', () => {
    expect(isRiskyCode('ok')).toBe(true);
    expect(isRiskyCode('OwlOk')).toBe(false);
    expect(isRiskyCode('owl_1')).toBe(false);
  });
});

describe('подложки и профили', () => {
  const plate = { id: 'owl-stars', title: 'Совы', kind: 'emoji', emoji: '🦉✨', opacity: 0.5, author: 'owl' };

  it('эмодзи: только эмодзи, составные считаются за один', () => {
    expect(isValidEmoji('🦉')).toBe(true);
    expect(isValidEmoji('👩‍💻🇷🇺❤️')).toBe(true);
    expect(isValidEmoji('🦉a')).toBe(false);
    expect(isValidEmoji('1️⃣')).toBe(false);
    expect(isValidEmoji('<svg>')).toBe(false);
    expect(isValidEmoji('🦉🦉🦉🦉🦉🦉')).toBe(true);
    expect(isValidEmoji('🦉🦉🦉🦉🦉🦉🦉')).toBe(false);
    expect(isValidEmoji('\u200D')).toBe(false);
  });

  it('подложка: эмодзи или картинка, но не оба; неизвестные поля отбрасываются', () => {
    expect(NameplateSchema.safeParse(plate).success).toBe(true);
    expect(NameplateSchema.safeParse({ ...plate, emoji: 'x' }).success).toBe(false);
    expect(NameplateSchema.safeParse({ ...plate, image: 'img/0123456789abcdef.webp' }).success).toBe(false);
    expect(NameplateSchema.safeParse({ ...plate, kind: 'image', emoji: undefined }).success).toBe(false);
    expect(NameplateSchema.safeParse({ ...plate, kind: 'image', emoji: undefined, image: 'img/0123456789abcdef.gif' }).success).toBe(true);
    expect(NameplateSchema.safeParse({ ...plate, opacity: 2 }).success).toBe(false);
    const future = NameplateSchema.safeParse({ ...plate, glow: true });
    expect(future.success && 'glow' in future.data).toBe(false);
  });

  it('профиль: свободная схема сохраняет поля будущих версий, но проверяет известные', () => {
    const r = ProfileSchema.safeParse({ nameplate: 'owl-stars', about: 'о себе' });
    expect(r.success && r.data).toEqual({ nameplate: 'owl-stars', about: 'о себе' });
    expect(ProfileSchema.safeParse({ nameplate: 'Bad Id' }).success).toBe(false);
  });
});

describe('описание иконки', () => {
  it('текст до 200 символов, без управляющих; незнакомые поля сохраняются', () => {
    expect(BadgeInfoSchema.safeParse({ description: 'строка\nвторая' }).success).toBe(true);
    expect(BadgeInfoSchema.safeParse({ description: 'x'.repeat(201) }).success).toBe(false);
    expect(BadgeInfoSchema.safeParse({ description: 'a\u0007' }).success).toBe(false);
    const r = BadgeInfoSchema.safeParse({ description: 'd', future: true });
    expect(r.success && r.data).toEqual({ description: 'd', future: true });
  });
});
