import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'isomorphic-git/http/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataRepo, jsonBytes } from '../src/git/repo';
import { startGitServer, TEST_KEY } from './helpers/git-server';

const IMG = 'img/0123456789abcdef.webp';
const emote = (code: string, image = IMG) => ({
  code,
  image,
  animated: false,
  w: 28,
  h: 28,
  author: 'test',
  createdAt: '2026-11-12T00:00:00.000Z',
});

let server: Awaited<ReturnType<typeof startGitServer>>;
const dirs: string[] = [];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-client-'));
  dirs.push(dir);
  return new DataRepo(fs, http, dir, {
    owner: 'owner',
    repo: 'data',
    branch: 'master',
    user: 'tester',
    token: TEST_KEY,
    host: server.origin,
  });
}

beforeAll(async () => {
  server = await startGitServer({
    'meta.json': JSON.stringify({ schema: 1 }),
    [IMG]: 'fake-webp',
    'emotes/CatJam.json': JSON.stringify(emote('CatJam')),
    'emotes/Broken.json': '{ not json',
    'emotes/Wrong.json': JSON.stringify(emote('Other')),
    'emotes/NoImage.json': JSON.stringify(emote('NoImage', 'img/ffffffffffffffff.webp')),
    'paints/gold.json': JSON.stringify({ id: 'gold', title: 'Золото', preset: 'gradient', colors: ['#ffcc00', '#ff8800'] }),
    'users/twitch/owl_viewer.json': JSON.stringify({ badges: [], paint: 'gold' }),
  });
});

afterAll(async () => {
  await server?.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('DataRepo', () => {
  it('читает снимок и отбрасывает невалидные файлы', async () => {
    const r = repo();
    const head = await r.fetchLatest();
    expect(await r.checkMeta(head)).toBe(true);
    const s = await r.readSnapshot(head);
    expect(Object.keys(s.emotes)).toEqual(['CatJam']);
    expect(s.paints.gold?.preset).toBe('gradient');
    expect(s.users['twitch:owl_viewer']?.paint).toBe('gold');
    expect(s.images[IMG]).toMatch(/^[0-9a-f]{40}$/);
    expect(s.problems.sort()).toEqual(['emotes/Broken.json', 'emotes/NoImage.json', 'emotes/Wrong.json']);
    expect(new TextDecoder().decode(await r.readBlob(s.images[IMG]!))).toBe('fake-webp');
  });

  it('коммитит и пушит изменения, в том числе удаление', async () => {
    const r = repo();
    await r.commitAndPush(
      () => new Map([['emotes/OwlYes.json', jsonBytes(emote('OwlYes'))], ['emotes/Broken.json', null]]),
      'add OwlYes',
      'tester',
    );
    const files = server.files();
    expect(files).toContain('emotes/OwlYes.json');
    expect(files).not.toContain('emotes/Broken.json');
    expect(files).toContain('meta.json');

    const fresh = repo();
    const snap = await fresh.readSnapshot(await fresh.fetchLatest());
    expect(snap.emotes.OwlYes?.code).toBe('OwlYes');
  });

  it('при гонке двух записей сохраняются обе', async () => {
    const a = repo();
    const b = repo();
    await Promise.all([
      a.commitAndPush(() => new Map([['emotes/RaceA.json', jsonBytes(emote('RaceA'))]]), 'race A', 'a'),
      b.commitAndPush(() => new Map([['emotes/RaceB.json', jsonBytes(emote('RaceB'))]]), 'race B', 'b'),
    ]);
    const files = server.files();
    expect(files).toContain('emotes/RaceA.json');
    expect(files).toContain('emotes/RaceB.json');
  });

  it('ошибка проверки внутри mutate (код занят) не пушит ничего', async () => {
    const before = server.log().length;
    await expect(
      repo().commitAndPush(
        (snap) => {
          if (snap.emotes.CatJam) throw new Error('Код CatJam уже занят');
          return new Map();
        },
        'dup',
        'tester',
      ),
    ).rejects.toThrow('уже занят');
    expect(server.log().length).toBe(before);
  });

  it('синхронизация скачивает только новое; пересборка убирает удалённое', async () => {
    const writer = repo();
    const syncer = repo();
    await syncer.fetchLatest();
    const start = (await syncer.storageUsage()).bytes;
    const big = (i: number) => new Uint8Array(40 * 1024).map((_, j) => (j * 31 + i * 7919) % 251);
    for (let i = 0; i < 5; i++) {
      await writer.commitAndPush(() => new Map([[`junk/${i}.bin`, big(i)]]), `junk ${i}`, 't');
      await syncer.fetchLatest();
    }
    // Раньше каждая синхронизация скачивала репозиторий целиком (5 × растущий объём)
    const grown = (await syncer.storageUsage()).bytes - start;
    expect(grown).toBeLessThan(5 * 40 * 1024 * 1.5);
    // Свой коммит копия загрузки обратно не скачивает
    expect((await writer.storageUsage()).bytes).toBeLessThan(5 * 40 * 1024 * 1.5 + start * 2);

    await writer.commitAndPush(() => new Map([0, 1, 2, 3, 4].map((i) => [`junk/${i}.bin`, null])), 'clean', 't');
    await syncer.fetchLatest();
    expect(await syncer.compactIfBloated(true)).toBe(true);
    const after = await syncer.storageUsage();
    expect(after.packs).toBe(1);
    expect(after.bytes).toBeLessThan(start + 20 * 1024);
    // Копия после пересборки рабочая
    const snap = await syncer.readSnapshot(await syncer.fetchLatest());
    expect(snap.emotes.CatJam?.code).toBe('CatJam');
    expect(await syncer.compactIfBloated()).toBe(false);
  }, 30_000);

  it('без токена запись запрещена', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-client-'));
    dirs.push(dir);
    const anon = new DataRepo(fs, http, dir, { owner: 'owner', repo: 'data', branch: 'master', user: '', token: '', host: server.origin });
    await expect(anon.commitAndPush(() => new Map(), 'x', 'x')).rejects.toThrow('ключ');
  });
});
