import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { base64ToBytes, indexFromZip, zipHead } from '../src/obs/zip-data';

const IMG_A = 'img/aaaaaaaaaaaaaaaa.webp';
const IMG_B = 'img/bbbbbbbbbbbbbbbb.gif';
const json = (v: unknown) => strToU8(JSON.stringify(v));
const emote = (code: string, image: string, animated = false) => ({ code, image, animated, w: 112, h: 112, author: 'owl', createdAt: '2026-11-15' });

function archive(): Uint8Array {
  // Как архив GitFlic: файлы от корня и отдельные записи каталогов
  return zipSync({
    'README.md': strToU8('# data'),
    'meta.json': json({ schema: 1 }),
    'emotes/': new Uint8Array(),
    'emotes/OwlYes.json': json(emote('OwlYes', IMG_A)),
    'emotes/OwlDance.json': json(emote('OwlDance', IMG_B, true)),
    'emotes/Broken.json': strToU8('{ не json'),
    'emotes/NoImage.json': json(emote('NoImage', 'img/cccccccccccccccc.webp')),
    'emotes/WrongName.json': json(emote('OtherCode', IMG_A)),
    'badges/founder.json': json({ id: 'founder', title: 'Основатель', image: IMG_A, author: 'owl' }),
    'paints/gold.json': json({ id: 'gold', title: 'Золото', preset: 'solid', colors: ['#ffcc00'] }),
    'users/twitch/owl_viewer.json': json({ badges: ['founder'], paint: 'gold' }),
    [IMG_A]: new Uint8Array([1, 2, 3]),
    [IMG_B]: new Uint8Array([4, 5, 6]),
  });
}

describe('база из zip для OBS', () => {
  it('строит тот же индекс, что и расширение, и пропускает кривые файлы', async () => {
    const { index, images, problems } = await indexFromZip(archive(), 'h1');
    expect(Object.keys(index.emotes).sort()).toEqual(['OwlDance', 'OwlYes']);
    expect(index.emotes.OwlYes).toMatchObject({ img: IMG_A, animated: false, w: 112, author: 'owl' });
    expect(index.emotes.OwlDance!.animated).toBe(true);
    expect(index.badges.founder).toMatchObject({ img: IMG_A, title: 'Основатель' });
    expect(index.paints.gold!.preset).toBe('solid');
    expect(index.users['twitch:owl_viewer']).toEqual({ badges: ['founder'], paint: 'gold' });
    expect(problems.sort()).toEqual(['emotes/Broken.json', 'emotes/NoImage.json', 'emotes/WrongName.json']);
    expect(index.head).toBe('h1');
  });

  it('картинки — data: URL с типом по расширению', async () => {
    const { images } = await indexFromZip(archive(), 'h1');
    expect(Object.keys(images).sort()).toEqual([IMG_A, IMG_B]);
    expect(images[IMG_A]).toBe('data:image/webp;base64,AQID');
    expect(images[IMG_B]!.startsWith('data:image/gif;base64,')).toBe(true);
  });

  it('отпечаток архива меняется вместе с содержимым', async () => {
    const a = await zipHead(new Uint8Array([1, 2, 3]));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await zipHead(new Uint8Array([1, 2, 3]))).toBe(a);
    expect(await zipHead(new Uint8Array([1, 2, 4]))).not.toBe(a);
  });

  it('base64 → байты', () => {
    expect([...base64ToBytes('AQID')]).toEqual([1, 2, 3]);
  });
});
