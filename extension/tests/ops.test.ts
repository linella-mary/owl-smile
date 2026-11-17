import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/git/repo';
import {
  addBadge,
  allowed,
  savePaint,
  addEmote,
  addNameplate,
  combine,
  deleteBadge,
  deleteEmote,
  deleteNameplate,
  setBadgeDescription,
  deletePaint,
  renameEmote,
  setNameplate,
  setUser,
  type PreparedImage,
} from '../src/manage/ops';
import { isAnimated, sniff } from '../src/manage/image';

const A = 'img/aaaaaaaaaaaaaaaa.webp';
const B = 'img/bbbbbbbbbbbbbbbb.webp';
const C = 'img/cccccccccccccccc.gif';
const dec = (b: Uint8Array | null | undefined) => (b ? JSON.parse(new TextDecoder().decode(b)) : b);

function snap(): Snapshot {
  const emote = (code: string, image: string) => ({ code, image, animated: false, w: 28, h: 28, author: 'x', createdAt: '' });
  return {
    head: 'h',
    emotes: { CatJam: emote('CatJam', A), CatJam2: emote('CatJam2', A), OwlYes: emote('OwlYes', B) },
    badges: { founder: { id: 'founder', title: 'F', image: B, author: 'x' } },
    badgeInfo: { founder: { description: 'с первого стрима', future: 1 } },
    paints: { gold: { id: 'gold', title: 'G', preset: 'solid', colors: ['#ffcc00'] } },
    users: { 'twitch:owl': { badges: ['founder'], paint: 'gold' }, 'vk:solo': { badges: ['founder'] } },
    nameplates: {
      stars: { id: 'stars', title: 'Звёзды', kind: 'emoji', emoji: '⭐', author: 'x' },
      strip: { id: 'strip', title: 'Полоса', kind: 'image', image: C, author: 'x' },
    },
    // about — поле будущей версии: должно сохраняться при перезаписи профиля
    profiles: { 'twitch:owl': { nameplate: 'stars', about: 'привет' }, 'vk:solo': { nameplate: 'strip' } },
    images: { [A]: 'oidA', [B]: 'oidB', [C]: 'oidC' },
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

  it('обычный пользователь удаляет и переименовывает только свои смайлы', () => {
    const user = { nick: ' X ', admin: false }; // автор смайлов в снимке — «x»
    expect(() => deleteEmote('CatJam', user)(snap())).not.toThrow();
    expect(() => renameEmote('CatJam', 'CatDance', user)(snap())).not.toThrow();
    const other = { nick: 'someone', admin: false };
    expect(() => deleteEmote('CatJam', other)(snap())).toThrow('только админ');
    expect(() => renameEmote('CatJam', 'CatDance', other)(snap())).toThrow('только админ');
    expect(() => deleteEmote('CatJam', { nick: 'someone', admin: true })(snap())).not.toThrow();
  });

  it('иконки, эффекты и оформление зрителей — только админ; смайлы — все', () => {
    const user = { nick: 'me', admin: false };
    const adminActor = { nick: 'boss', admin: true };
    expect(allowed(addEmote('NewOne', img(A), 'me'), user)).toBe(true);
    expect(allowed(deleteEmote('CatJam'), user)).toBe(true);
    for (const m of [deleteBadge('founder'), savePaint({ id: 'red', title: 'R', preset: 'solid', colors: ['#ff0000'] }), setUser('twitch', 'owl', { badges: [] })]) {
      expect(allowed(m, user)).toBe(false);
      expect(allowed(m, adminActor)).toBe(true);
    }
    expect(allowed(combine(addEmote('NewOne', img(A), 'me'), deleteBadge('founder')), user)).toBe(false);
    expect(allowed(combine(addEmote('NewOne', img(A), 'me')), user)).toBe(true);
  });

  it('удаление и переименование смайла обновляют любимые смайлы в профилях', () => {
    const s = snap();
    s.profiles['twitch:owl']!.favEmotes = ['CatJam', 'OwlYes'];
    s.profiles['vk:solo']!.favEmotes = ['CatJam'];
    const renamed = renameEmote('CatJam', 'CatDance')(s);
    expect(dec(renamed.get('profiles/twitch/owl.json')).favEmotes).toEqual(['CatDance', 'OwlYes']);
    const deleted = deleteEmote('CatJam')(s);
    expect(dec(deleted.get('profiles/twitch/owl.json'))).toEqual({ nameplate: 'stars', about: 'привет', favEmotes: ['OwlYes'] });
    // Последний любимый смайл — поле убирается, остальной профиль остаётся
    expect(dec(deleted.get('profiles/vk/solo.json'))).toEqual({ nameplate: 'strip' });
    expect(deleteEmote('OwlYes')(snap()).has('profiles/twitch/owl.json')).toBe(false);
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

  it('addNameplate: эмодзи и картинка, проверки', () => {
    const ch = addNameplate({ id: 'owl-stars', title: 'Совы', kind: 'emoji', emoji: '🦉✨', opacity: 0.456 }, 'me')(snap());
    expect(dec(ch.get('nameplates/owl-stars.json'))).toEqual({ id: 'owl-stars', title: 'Совы', kind: 'emoji', emoji: '🦉✨', opacity: 0.46, author: 'me' });
    const ch2 = addNameplate({ id: 'wide', title: 'W', kind: 'image', image: img('img/dddddddddddddddd.webp'), opacity: 1 }, 'me')(snap());
    expect(ch2.has('img/dddddddddddddddd.webp')).toBe(true);
    expect(() => addNameplate({ id: 'x1', title: 'T', kind: 'emoji', emoji: 'abc', opacity: 1 }, 'me')).toThrow('Только эмодзи');
    expect(() => addNameplate({ id: 'x1', title: 'T', kind: 'emoji', emoji: '🦉🦉🦉🦉🦉🦉🦉', opacity: 1 }, 'me')).toThrow('Только эмодзи');
    expect(() => addNameplate({ id: 'x1', title: 'T', kind: 'image', opacity: 1 }, 'me')).toThrow('картинку');
    expect(() => addNameplate({ id: 'stars', title: 'T', kind: 'emoji', emoji: '⭐', opacity: 1 }, 'me')(snap())).toThrow('уже есть');
  });

  it('deleteNameplate: снимает со зрителей (остальной профиль цел), удаляет ненужную картинку', () => {
    const ch = deleteNameplate('stars')(snap());
    expect(ch.get('nameplates/stars.json')).toBeNull();
    expect(dec(ch.get('profiles/twitch/owl.json'))).toEqual({ about: 'привет' });
    const ch2 = deleteNameplate('strip')(snap());
    expect(ch2.get('profiles/vk/solo.json')).toBeNull(); // пустой профиль — файл удаляется
    expect(ch2.get(C)).toBeNull();
  });

  it('удаление смайла не трогает картинку, нужную подложке', () => {
    const s = snap();
    s.emotes.Strip = { code: 'Strip', image: C, animated: true, w: 28, h: 28, author: 'x', createdAt: '' };
    expect(deleteEmote('Strip')(s).has(C)).toBe(false);
  });

  it('setNameplate: назначает и снимает, не теряя других полей профиля', () => {
    expect(dec(setNameplate('twitch', 'Owl', 'strip')(snap()).get('profiles/twitch/owl.json'))).toEqual({ nameplate: 'strip', about: 'привет' });
    expect(dec(setNameplate('twitch', 'owl', undefined)(snap()).get('profiles/twitch/owl.json'))).toEqual({ about: 'привет' });
    const fresh = dec(setNameplate('vk', 'Новый Ник', 'stars')(snap()).get('profiles/vk/новый ник.json'));
    // Новый профиль получает дату «в Owl Smile с…»
    expect(fresh).toEqual({ nameplate: 'stars', since: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });
    expect(setNameplate('twitch', 'owl', 'stars')(snap()).size).toBe(0);
    expect(() => setNameplate('twitch', 'owl', 'nope')(snap())).toThrow('не найдена');
    expect(() => setNameplate('twitch', 'bad nick!', 'stars')).toThrow();
  });

  it('combine: оформление и подложка одним коммитом', () => {
    const ch = combine(setUser('twitch', 'newbie', { badges: ['founder'] }), setNameplate('twitch', 'newbie', 'stars'))(snap());
    expect([...ch.keys()].sort()).toEqual(['profiles/twitch/newbie.json', 'users/twitch/newbie.json']);
  });

  it('описание иконки: отдельным файлом, правка сохраняет незнакомые поля, удаление иконки удаляет и его', () => {
    const ch = addBadge('mod', 'Модератор', img(A), 'me', '  Следит за порядком  ')(snap());
    expect(dec(ch.get('badges/mod.json'))).toEqual({ id: 'mod', title: 'Модератор', image: A, author: 'me' }); // формат старых версий
    expect(dec(ch.get('badges-info/mod.json'))).toEqual({ description: 'Следит за порядком' });
    expect(addBadge('mod2', 'M', img(A), 'me')(snap()).has('badges-info/mod2.json')).toBe(false);
    expect(() => addBadge('mod3', 'M', img(A), 'me', 'x'.repeat(201))).toThrow('до 200');

    expect(dec(setBadgeDescription('founder', 'новое')(snap()).get('badges-info/founder.json'))).toEqual({ description: 'новое', future: 1 });
    expect(dec(setBadgeDescription('founder', '')(snap()).get('badges-info/founder.json'))).toEqual({ future: 1 });
    expect(setBadgeDescription('founder', 'с первого стрима')(snap()).size).toBe(0);
    expect(() => setBadgeDescription('nope', 'x')(snap())).toThrow('не найдена');

    expect(deleteBadge('founder')(snap()).get('badges-info/founder.json')).toBeNull();
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
