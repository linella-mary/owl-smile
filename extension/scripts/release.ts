/**
 * Выпуск новой версии расширения в релизы GitFlic.
 *
 *   npm run release -- 0.2.0 "Что нового"
 *
 * 1. проверяет, что в git нет незакоммиченных изменений;
 * 2. ставит версию в package.json (если указана) и коммитит;
 * 3. собирает zip и проверяет, что в сборку не попал ни один токен из .env;
 * 4. ставит тег vX.Y.Z и пушит ветку и тег в проект с кодом (обычными учётными данными git);
 * 5. создаёт релиз через API GitFlic и прикрепляет zip.
 *
 * Нужны в .env: WXT_GITFLIC_OWNER, GITFLIC_CODE_REPO, GITFLIC_API_TOKEN (личный API-токен GitFlic).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const owner = process.env.WXT_GITFLIC_OWNER ?? '';
const codeRepo = process.env.GITFLIC_CODE_REPO ?? '';
const apiToken = process.env.GITFLIC_API_TOKEN ?? '';
const codeDeployToken = process.env.GITFLIC_CODE_DEPLOY_TOKEN ?? '';
const pushUser = process.env.WXT_GITFLIC_USER || owner;
const API = 'https://api.gitflic.ru';

const [versionArg, notesArg] = process.argv.slice(2);
const root = path.resolve('..');

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

/** git в корне проекта (safe.directory — диск без владельцев файлов). */
const git = (...args: string[]) =>
  execFileSync('git', ['-c', `safe.directory=${root.replace(/\\/g, '/')}`, ...args], { cwd: root, encoding: 'utf8' }).trim();

async function api(method: string, url: string, body?: BodyInit, json = true): Promise<any> {
  const res = await fetch(API + url, {
    method,
    headers: { Authorization: `token ${apiToken}`, ...(json && body ? { 'Content-Type': 'application/json' } : {}) },
    body,
  });
  const text = await res.text();
  if (!res.ok) fail(`API ${method} ${url} → ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  if (!owner || !codeRepo) fail('Заполните WXT_GITFLIC_OWNER и GITFLIC_CODE_REPO в extension/.env');

  // 1. Чистое дерево
  if (git('status', '--porcelain')) fail('Есть незакоммиченные изменения — закоммитьте их перед релизом');

  // 2. Версия
  const pkgPath = path.resolve('package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (versionArg) {
    if (!/^\d+\.\d+\.\d+$/.test(versionArg)) fail('Версия в формате 1.2.3');
    if (versionArg !== pkg.version) {
      pkg.version = versionArg;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      git('add', 'extension/package.json');
      git('commit', '-m', `Версия ${versionArg}`);
    }
  }
  const version: string = pkg.version;
  const tag = `v${version}`;
  if (git('tag', '--list', tag)) fail(`Тег ${tag} уже есть — укажите новую версию: npm run release -- X.Y.Z`);

  // 3. Сборка и проверка на утечку токенов
  console.log(`• Сборка ${version}…`);
  execFileSync('npx', ['wxt', 'zip'], { stdio: 'inherit', shell: true });
  const outDir = path.resolve('.output');
  const secrets = Object.entries(process.env)
    .filter(([k, v]) => /TOKEN/.test(k) && v && v.length >= 8)
    .map(([, v]) => v!);
  for (const f of fs.readdirSync(path.join(outDir, 'chrome-mv3'), { recursive: true })) {
    const p = path.join(outDir, 'chrome-mv3', String(f));
    if (fs.statSync(p).isFile() && secrets.some((s) => fs.readFileSync(p, 'latin1').includes(s)))
      fail(`В сборке найден токен из .env (${f}) — релиз остановлен`);
  }
  const built = fs.readdirSync(outDir).find((f) => f.endsWith(`${version}-chrome.zip`));
  if (!built) fail('Не найден собранный zip');
  const zipName = `owl-smile-${version}.zip`;
  fs.copyFileSync(path.join(outDir, built), path.join(outDir, zipName));
  console.log(`✔ ${zipName}, токенов в сборке нет`);

  // 4. Тег и push кода (токеном развёртывания проекта, если задан; иначе — учётными данными git)
  git('tag', '-a', tag, '-m', `Owl Smile ${version}`);
  console.log(`• Push кода и тега ${tag}…`);
  const codeUrl = `https://gitflic.ru/project/${owner}/${codeRepo}.git`;
  const auth = codeDeployToken
    ? ['-c', `http.extraHeader=Authorization: Basic ${Buffer.from(`${pushUser}:${codeDeployToken}`).toString('base64')}`, '-c', 'credential.helper=']
    : [];
  execFileSync('git', ['-c', `safe.directory=${root.replace(/\\/g, '/')}`, ...auth, 'push', codeUrl, 'HEAD:refs/heads/master', `refs/tags/${tag}`], {
    cwd: root,
    stdio: 'inherit',
  });

  const description = [notesArg ?? '', '', 'Как установить или обновить — см. README проекта.'].join('\n').trim();
  if (!apiToken) {
    console.log(`
Код и тег ${tag} отправлены. Личного API-токена (GITFLIC_API_TOKEN) нет, поэтому релиз создайте вручную:
  1. https://gitflic.ru/project/${owner}/${codeRepo}/release → «Создать релиз»
  2. Тег: ${tag}, название: Owl Smile ${version}
  3. Описание: ${description.replace(/\n+/g, ' ')}
  4. Прикрепите файл: ${path.join(outDir, zipName)}`);
    return;
  }

  // 5. Релиз
  const base = `/project/${owner}/${codeRepo}/release`;
  const release = await api('POST', base, JSON.stringify({
    title: `Owl Smile ${version}`,
    description,
    tagName: tag,
    preRelease: false,
    attachProjectArchive: false,
  }));
  const uuid: string | undefined = release?.uuid ?? release?.id ?? release?.releaseUuid;
  if (!uuid) fail(`Не понял ответ API при создании релиза: ${JSON.stringify(release).slice(0, 300)}`);

  const form = new FormData();
  form.append('files', new Blob([fs.readFileSync(path.join(outDir, zipName))], { type: 'application/zip' }), zipName);
  await api('POST', `${base}/${uuid}/file`, form, false);

  console.log(`\n✔ Релиз ${tag} опубликован: https://gitflic.ru/project/${owner}/${codeRepo}/release`);
}

void main();
