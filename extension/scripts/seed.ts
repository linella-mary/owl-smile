/**
 * Начальное заполнение репозитория данных файлами из ../data-seed.
 * Если ветка пустая — создаёт первый коммит; если уже есть — доливает недостающие файлы.
 * Пушит через isomorphic-git с токеном развёртывания — тем же способом, что и расширение.
 * Запуск: npm run seed
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import git from 'isomorphic-git';
import nodeHttp from 'isomorphic-git/http/node';
import { DataRepo, withUserAgent } from '../src/git/repo';
import { repoUrl, type RepoConfig } from '../src/shared/config';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const env = process.env;
const cfg: RepoConfig = {
  owner: env.WXT_GITFLIC_OWNER ?? '',
  repo: env.WXT_GITFLIC_REPO ?? '',
  branch: env.WXT_GITFLIC_BRANCH ?? 'master',
  user: env.WXT_GITFLIC_USER ?? '',
  token: env.GITFLIC_DEPLOY_TOKEN ?? '',
};
if (!cfg.owner || !cfg.repo || !cfg.user || !cfg.token) {
  console.error('Заполните WXT_GITFLIC_OWNER, _REPO, _USER и _DEPLOY_TOKEN в extension/.env');
  process.exit(1);
}
const http = withUserAgent(nodeHttp);
const url = repoUrl(cfg);
const onAuth = () => ({ username: cfg.user, password: cfg.token });
const seedDir = path.resolve('../data-seed');
const seedFiles = fs.readdirSync(seedDir);

async function createBranch(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-seed-'));
  try {
    await git.init({ fs, dir, defaultBranch: cfg.branch });
    for (const file of seedFiles) {
      fs.copyFileSync(path.join(seedDir, file), path.join(dir, file));
      await git.add({ fs, dir, filepath: file });
    }
    const who = { name: cfg.user, email: 'owl-smile@users.noreply' };
    const oid = await git.commit({ fs, dir, message: 'Начальная структура Owl Smile', author: who });
    const res = await git.push({ fs, http, dir, url, ref: cfg.branch, remoteRef: `refs/heads/${cfg.branch}`, onAuth });
    if (!res.ok) throw new Error(res.error ?? 'push отклонён');
    console.log(`Создана ветка ${cfg.branch}: ${oid.slice(0, 7)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function addMissing(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-seed-'));
  try {
    const repo = new DataRepo(fs, nodeHttp, dir, cfg);
    let added: string[] = [];
    await repo.commitAndPush(
      async () => {
        const head = await repo.fetchLatest();
        const root = (await git.readTree({ fs, dir, oid: head })).tree.map((e) => e.path);
        added = seedFiles.filter((f) => !root.includes(f));
        return new Map(added.map((f) => [f, new Uint8Array(fs.readFileSync(path.join(seedDir, f)))]));
      },
      'Начальная структура Owl Smile',
      cfg.user,
    );
    console.log(added.length ? `Добавлены: ${added.join(', ')}` : 'Все начальные файлы уже на месте.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const refs = await git.listServerRefs({ http, url, onAuth, protocolVersion: 1 });
  if (refs.some((r) => r.ref === `refs/heads/${cfg.branch}`)) await addMissing();
  else await createBranch();
}

main().catch((e) => {
  console.error('Ошибка:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
