/**
 * Этап 0.1 — проверка, что GitFlic работает с isomorphic-git:
 *   1) неглубокий fetch публичного репозитория без авторизации;
 *   2) push с токеном развёртывания;
 *   3) гонка двух одновременных записей (оба изменения должны сохраниться);
 *   4) удаление тестовых файлов.
 *
 * Запуск: заполнить extension/.env (см. .env.example) и выполнить `npm run spike:gitflic`.
 * Только чтение: `npm run spike:gitflic -- --read-only`.
 */
import fs from 'node:fs';
import path from 'node:path';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { DataRepo, jsonBytes, type Changes } from '../src/git/repo';
import { repoUrl, type RepoConfig } from '../src/shared/config';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const env = process.env;
const cfg: RepoConfig = {
  owner: env.WXT_GITFLIC_OWNER ?? '',
  repo: env.WXT_GITFLIC_REPO ?? 'owl-smile-data',
  branch: env.WXT_GITFLIC_BRANCH ?? 'master',
  user: env.WXT_GITFLIC_USER ?? '',
  token: env.GITFLIC_DEPLOY_TOKEN ?? '',
};
if (!cfg.owner) {
  console.error('Заполните WXT_GITFLIC_OWNER в extension/.env');
  process.exit(1);
}
const readOnly = process.argv.includes('--read-only') || !cfg.token;

const work = path.resolve('.spike');
fs.rmSync(work, { recursive: true, force: true });
const mk = (name: string) => {
  const dir = path.join(work, name);
  fs.mkdirSync(dir, { recursive: true });
  return new DataRepo(fs, http, dir, cfg);
};

async function step<T>(title: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  process.stdout.write(`• ${title} ... `);
  try {
    const r = await fn();
    console.log(`OK (${Date.now() - t} мс)`);
    return r;
  } catch (e) {
    console.log('ОШИБКА');
    throw e;
  }
}

const marker = `spike/${Date.now()}`;
const add = (file: string): ((s: unknown) => Changes) => () => new Map([[file, jsonBytes({ at: new Date().toISOString() })]]);

async function main() {
  console.log(`Репозиторий: ${repoUrl(cfg)} (ветка ${cfg.branch})\n`);
  const a = mk('a');

  const head = await step('Неглубокий fetch без авторизации', async () => {
    const anon = new DataRepo(fs, http, path.join(work, 'anon'), { ...cfg, user: '', token: '' });
    fs.mkdirSync(path.join(work, 'anon'), { recursive: true });
    return anon.fetchLatest();
  });
  console.log(`  HEAD = ${head}`);

  await step('Чтение снимка', async () => {
    const h = await a.fetchLatest();
    const s = await a.readSnapshot(h);
    console.log(
      `\n  meta.json: ${(await a.checkMeta(h)) ? 'ok' : 'НЕТ/неверный'}; смайлов ${Object.keys(s.emotes).length}, ` +
        `иконок ${Object.keys(s.badges).length}, картинок ${Object.keys(s.images).length}, ошибок ${s.problems.length}`,
    );
  });

  if (readOnly) {
    console.log('\nТокен не задан или --read-only: проверка записи пропущена.');
    return;
  }

  await step('Push с токеном развёртывания', () => a.commitAndPush(add(`${marker}/a.json`), 'spike: запись', 'spike'));

  await step('Гонка двух записей (ожидается повтор)', async () => {
    const b = mk('b');
    const c = mk('c');
    await Promise.all([
      b.commitAndPush(add(`${marker}/b.json`), 'spike: гонка b', 'spike'),
      c.commitAndPush(add(`${marker}/c.json`), 'spike: гонка c', 'spike'),
    ]);
    const s = mk('check');
    const h = await s.fetchLatest();
    const list = await git.readTree({ fs, dir: path.join(work, 'check'), oid: h, filepath: marker });
    for (const f of ['a', 'b', 'c']) {
      if (!list.tree.some((e) => e.path === `${f}.json`)) throw new Error(`Потерян ${marker}/${f}.json`);
    }
  });

  await step('Удаление тестовых файлов', () =>
    a.commitAndPush(
      () => new Map([[`${marker}/a.json`, null], [`${marker}/b.json`, null], [`${marker}/c.json`, null]]),
      'spike: очистка',
      'spike',
    ),
  );

  console.log('\nВсё работает: isomorphic-git + GitFlic + токен развёртывания подходят.');
}

main()
  .catch((e) => {
    console.error('\n', e);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(work, { recursive: true, force: true }));
