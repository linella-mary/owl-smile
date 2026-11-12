import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/git/repo';
import { addBadge, addEmote, deleteBadge, deleteEmote, deletePaint, renameEmote, setUser, type PreparedImage } from '../src/manage/ops';
import { isAnimated, sniff } from '../src/manage/image';

const A = 'img/aaaaaaaaaaaaaaaa.webp';
const B = 'img/bbbbbbbbbbbbbbbb.webp';
const dec = (b: Uint8Array | null | undefined) => (b ? JSON.parse(new TextDecoder().decode(b)) : b);

function snap(): Snapshot {
  const emote = (code: string, image: string) => ({ code, image, animated: false, w: 28, h: 28, author: 'x', createdAt: '' });
  return {
    head: 'h',
    emotes: { CatJam: emote('CatJam', A), CatJam2: emote('CatJam2', A), OwlYes: emote('OwlYes', B) },
    badges: { founder: { id: 'founder', title: 'F', image: B, author: 'x' } },
    paints: { gold: { id: 'gold', title: 'G', preset: 'solid', colors: ['#ffcc00'] } },
    users: { 'twitch:owl': { badges: ['founder'], paint: 'gold' }, 'vk:solo': { badges: ['founder'] } },
    images: { [A]: 'oidA', [B]: 'oidB' },
    problems: [],
  };
}

const img = (path: string): PreparedImage => ({ bytes: new Uint8Array([1]), path, w: 28, h: 28, animated: false });

describe('операции', () => {
  it('addEmote: занятый код без учёта регистра → ошибка; картинка не дублируется', () => {
    expect(() => addEmote('catjam', img(A), 'me')(snap())).toThrow('уже занят');
    expect(() => addEmote('bad code', img(A), 'me')).toThrow();
    const ch = addEmote('NewOne', img(A), 'me')(snap());
    expect([...ch.keys()]).toEqual(['emotes/NewOne.json']);
    const ch2 = addEmote('NewTwo', img('img/cccccccccccccccc.webp'), 'me')(snap());
    expect(ch2.has('img/cccccccccccccccc.webp')).toBe(true);
    expect(dec(ch2.get('emotes/NewTwo.json')).author).toBe('me');
  });

  it('deleteEmote: общая картинка остаётся, единственная — удаляется только если не нужна иконке', () => {
    expect([...deleteEmote('CatJam')(snap()).keys()]).toEqual(['emotes/CatJam.json']);
    // B используется ещё и иконкой founder
    expect([...deleteEmote('OwlYes')(snap()).keys()]).toEqual(['emotes/OwlYes.json']);
    const s = snap();
    delete s.emotes.CatJam2;
    expect(deleteEmote('CatJam')(s).get(A)).toBeNull();
  });

  it('renameEmote: переносит файл, проверяет занятость', () => {
    const ch = renameEmote('CatJam', 'CatDance')(snap());
    expect(ch.get('emotes/CatJam.json')).toBeNull();
    expect(dec(ch.get('emotes/CatDance.json')).code).toBe('CatDance');
    expect(() => renameEmote('CatJam', 'OWLYES')(snap())).toThrow('занят');
    expect(() => renameEmote('CatJam', 'catjam')(snap())).not.toThrow();
  });

  it('deleteBadge: снимает иконку с пользователей, пустых удаляет', () => {
    const ch = deleteBadge('founder')(snap());
    expect(ch.get('badges/founder.json')).toBeNull();
    expect(dec(ch.get('users/twitch/owl.json'))).toEqual({ badges: [], paint: 'gold' });
    expect(ch.get('users/vk/solo.json')).toBeNull();
    expect(ch.has(B)).toBe(false); // B ещё у смайла OwlYes
  });

  it('deletePaint снимает эффект', () => {
    expect(dec(deletePaint('gold')(snap()).get('users/twitch/owl.json'))).toEqual({ badges: ['founder'] });
  });

  it('setUser: проверяет ссылки, ник в нижний регистр', () => {
    const ch = setUser('twitch', 'Owl_Viewer', { badges: ['founder'], paint: 'gold' })(snap());
    expect(dec(ch.get('users/twitch/owl_viewer.json'))).toEqual({ badges: ['founder'], paint: 'gold' });
    expect(() => setUser('twitch', 'x', { badges: ['nope'] })(snap())).toThrow('не найдена');
    expect(setUser('vk', 'solo', { badges: [] })(snap()).get('users/vk/solo.json')).toBeNull();
  });

  it('addBadge: проверка ID', () => {
    expect(() => addBadge('Bad ID', 't', img(A), 'me')).toThrow();
    expect(() => addBadge('founder', 't', img(A), 'me')(snap())).toThrow('уже есть');
  });
});

describe('распознавание картинок', () => {
  const bytes = (...parts: (string | number[])[]) =>
    new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

  it('sniff по сигнатуре, а не по имени', () => {
    expect(sniff(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(sniff(bytes('GIF89a', [0, 0]))).toBe('gif');
    expect(sniff(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))).toBe('webp');
    expect(sniff(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniff(bytes('MZ', [0x90, 0, 3, 0, 0, 0, 4, 0]))).toBeNull(); // .exe
    expect(sniff(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
  });

  it('анимированный WebP / GIF', () => {
    const vp8x = (flags: number) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0, flags, 0, 0, 0]);
    expect(isAnimated(vp8x(0x02), 'webp')).toBe(true);
    expect(isAnimated(vp8x(0x10), 'webp')).toBe(false);
    const gce = [0x21, 0xf9, 0x04, 0, 0, 0, 0, 0];
    const gif = (n: number) => bytes('GIF89a', new Array(7).fill(0), ...new Array(n).fill(gce));
    expect(isAnimated(gif(1), 'gif')).toBe(false);
    expect(isAnimated(gif(3), 'gif')).toBe(true);
  });
});

describe('размеры картинок', async () => {
  const { emoteSize, badgeSize, qualityWarnings } = await import('../src/manage/image');

  it('смайл: высота 112 (4x от 28), пропорции сохраняются, без увеличения', () => {
    expect(emoteSize(600, 400)).toEqual({ w: 168, h: 112 });
    expect(emoteSize(1000, 1000)).toEqual({ w: 112, h: 112 });
    expect(emoteSize(448, 112)).toEqual({ w: 448, h: 112 });
    expect(emoteSize(28, 28)).toEqual({ w: 28, h: 28 });
  });

  it('иконка: вписывается в 72×72 (4x от 18), без увеличения', () => {
    expect(badgeSize(200, 200)).toEqual({ w: 72, h: 72 });
    expect(badgeSize(144, 72)).toEqual({ w: 72, h: 36 });
    expect(badgeSize(18, 18)).toEqual({ w: 18, h: 18 });
  });

  it('предупреждения о мелких и неквадратных картинках', () => {
    expect(qualityWarnings('emote', 112, 112)).toEqual([]);
    expect(qualityWarnings('emote', 32, 32)[0]).toContain('мелкая');
    expect(qualityWarnings('badge', 72, 72)).toEqual([]);
    expect(qualityWarnings('badge', 18, 18)[0]).toContain('мелкая');
    expect(qualityWarnings('badge', 144, 72).some((w) => w.includes('не квадратная'))).toBe(true);
  });
});
