/**
 * Замер: сколько места занимает локальная git-копия данных при долгой работе.
 * Сценарий: 20 загрузок смайлов по 60 КБ, затем удаление 15; после каждого шага — синхронизация.
 * Запуск: npx tsx scripts/measure-git-growth.ts
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'isomorphic-git/http/node';
import { DataRepo, jsonBytes } from '../src/git/repo';
import { startGitServer, TEST_KEY } from '../tests/helpers/git-server';

const dirSize = (d: string): number =>
  fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? dirSize(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
const kb = (n: number) => `${Math.round(n / 1024)} КБ`;

async function main() {
  const server = await startGitServer({ 'meta.json': JSON.stringify({ schema: 1 }) });
  const mk = (token: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-measure-'));
    return { dir, repo: new DataRepo(fs, http, dir, { owner: 'owner', repo: 'data', branch: 'master', user: 'tester', token, host: server.origin }) };
  };
  const writer = mk(TEST_KEY);
  const syncer = mk('');
  const report = async (step: string) => {
    const head = await syncer.repo.fetchLatest();
    const snap = await syncer.repo.readSnapshot(head);
    const live = (await Promise.all(Object.values(snap.images).map((oid) => syncer.repo.readBlob(oid)))).reduce((s, b) => s + b.length, 0);
    const packs = fs.readdirSync(path.join(syncer.dir, '.git/objects/pack')).filter((f) => f.endsWith('.pack')).length;
    console.log(`${step}: картинок в репозитории ${Object.keys(snap.images).length} (${kb(live)}); копия синхронизации ${kb(dirSize(syncer.dir))}, pack-файлов ${packs}; копия загрузки ${kb(dirSize(writer.dir))}`);
  };
  try {
    await report('старт');
    for (let i = 0; i < 20; i++) {
      const img = `img/${randomBytes(8).toString('hex')}.webp`;
      const code = `Emote${i}`;
      await writer.repo.commitAndPush(
        () => new Map([[img, randomBytes(60 * 1024)], [`emotes/${code}.json`, jsonBytes({ code, image: img, animated: false, w: 28, h: 28, author: 't', createdAt: '' })]]),
        `add ${code}`,
        't',
      );
      await syncer.repo.fetchLatest();
    }
    await report('после 20 загрузок');
    for (let i = 0; i < 15; i++) {
      await writer.repo.commitAndPush((snap) => {
        const e = snap.emotes[`Emote${i}`]!;
        return new Map([[`emotes/Emote${i}.json`, null], [e.image, null]]);
      }, `del ${i}`, 't');
      await syncer.repo.fetchLatest();
    }
    await report('после удаления 15');
    const compacted = [await syncer.repo.compactIfBloated(), await writer.repo.compactIfBloated()];
    await report(`по порогам (${compacted.map((c) => (c ? 'пересобрано' : 'не нужно')).join(' / ')})`);
    await syncer.repo.compactIfBloated(true);
    await writer.repo.compactIfBloated(true);
    await report('после принудительной пересборки');
    // Копия работает после пересборки: ещё одна загрузка и синхронизация
    await writer.repo.commitAndPush((snap) => new Map([[`emotes/After.json`, jsonBytes({ ...snap.emotes.Emote19!, code: 'After' })]]), 'after', 't');
    await report('загрузка после пересборки');
  } finally {
    await server.close();
    for (const d of [writer.dir, syncer.dir]) fs.rmSync(d, { recursive: true, force: true });
  }
}

void main();
