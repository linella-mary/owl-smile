/**
 * Firefox: сборка, проверка на токены и подпись в Mozilla без публикации в каталоге (канал unlisted).
 *
 *   npm run sign:firefox
 *
 * Нужны в .env: AMO_JWT_ISSUER и AMO_JWT_SECRET — https://addons.mozilla.org/ru/developers/addon/api/key/
 * (меню «Инструменты» → «Управление ключами API»). Результат: .output/owl-smile-X.Y.Z-firefox.xpi (ставится в Firefox насовсем).
 * Одну и ту же версию Mozilla подписывает один раз: для новой подписи поднимите версию.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

/** Значения секретов из .env: по ним ищем утечки в сборке. */
export function secretValues(): string[] {
  return Object.entries(process.env)
    .filter(([k, v]) => /TOKEN|SECRET/.test(k) && v && v.length >= 8)
    .map(([, v]) => v!);
}

/** Файлы каталога (рекурсивно), кроме пропущенных папок. */
function files(dir: string, skip: Set<string> = new Set()): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p, skip));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** Бросает ошибку, если в файлах есть значение секрета. */
export function assertNoSecrets(list: string[], what: string): void {
  const secrets = secretValues();
  for (const p of list) {
    const text = fs.readFileSync(p, 'latin1');
    if (secrets.some((s) => text.includes(s))) throw new Error(`${what}: найден токен из .env (${p}) — остановлено`);
  }
}

/** Собирает Firefox-версию, проверяет её и подписывает. Возвращает путь к .xpi. */
export function buildAndSignFirefox(version: string): string {
  const issuer = process.env.AMO_JWT_ISSUER ?? '';
  const secret = process.env.AMO_JWT_SECRET ?? '';
  if (!issuer || !secret) throw new Error('Заполните AMO_JWT_ISSUER и AMO_JWT_SECRET в extension/.env');

  console.log(`• Сборка для Firefox ${version}…`);
  execFileSync('npx', ['wxt', 'zip', '-b', 'firefox'], { stdio: 'inherit', shell: true });
  const outDir = path.resolve('.output');
  const built = path.join(outDir, 'firefox-mv2');
  const sources = path.join(outDir, `owl-smile-${version}-sources.zip`);
  if (!fs.existsSync(sources)) throw new Error(`Не найден архив исходников ${sources}`);

  assertNoSecrets(files(built), 'Сборка Firefox');
  // Архив исходников собирается из этих файлов (.env исключён в wxt.config.ts) — проверяем их на диске
  assertNoSecrets(
    files('.', new Set(['node_modules', '.output', '.output-e2e', '.wxt', '.spike', 'web-ext-artifacts', 'test-results'])).filter(
      (p) => !path.basename(p).startsWith('.env'),
    ),
    'Исходники',
  );
  console.log('✔ Токенов в сборке и исходниках нет');

  console.log('• Подпись в Mozilla (обычно несколько минут)…');
  const artifacts = path.join(outDir, 'firefox-signed');
  fs.rmSync(artifacts, { recursive: true, force: true });
  // Ключи — через переменные окружения, а не аргументы: так их не видно в списке процессов
  execFileSync(
    'npx',
    // web-ext не в зависимостях проекта: его пакеты перемешивали node_modules и ломали vitest
    ['--yes', 'web-ext@10.8.0', 'sign', '--channel', 'unlisted', '--source-dir', built, '--artifacts-dir', artifacts, '--upload-source-code', sources],
    { stdio: 'inherit', shell: true, env: { ...process.env, WEB_EXT_API_KEY: issuer, WEB_EXT_API_SECRET: secret } },
  );
  const xpi = fs.readdirSync(artifacts).find((f) => f.endsWith('.xpi'));
  if (!xpi) throw new Error('Mozilla не вернула подписанный файл — смотрите вывод web-ext выше');
  const target = path.join(outDir, `owl-smile-${version}-firefox.xpi`);
  fs.copyFileSync(path.join(artifacts, xpi), target);
  console.log(`✔ ${path.basename(target)} подписан`);
  return target;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string };
    buildAndSignFirefox(version);
  } catch (e) {
    console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
