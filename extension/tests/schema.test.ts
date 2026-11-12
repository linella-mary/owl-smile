import { describe, expect, it } from 'vitest';
import { EmoteSchema, PaintSchema, UserSchema, isRiskyCode } from '../src/shared/schema';

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
