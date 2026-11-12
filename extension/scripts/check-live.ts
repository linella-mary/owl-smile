/**
 * Проверка рабочей сборки против настоящего GitFlic в Chromium.
 *   npm run check:live            — синхронизация (только чтение)
 *   npm run check:live -- --write — плюс загрузка и удаление тестового смайла через страницу manage
 * Сборка берётся из .output/chrome-mv3 (npm run build с заполненным .env).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Worker } from 'playwright';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const CODE = `OwlLiveTest${Date.now() % 100000}`;
const write = process.argv.includes('--write');

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 60000): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

const storage = (sw: Worker, key: string): Promise<any> =>
  sw.evaluate(async (k) => {
    const api = (globalThis as unknown as { chrome: { storage: { local: { get(k: string): Promise<Record<string, unknown>> } } } }).chrome;
    return (await api.storage.local.get(k))[k];
  }, key);

async function main() {
  const ext = path.resolve('.output/chrome-mv3');
  if (!fs.existsSync(path.join(ext, 'manifest.json'))) throw new Error('Нет сборки: выполните npm run build');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-live-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  let ok = true;
  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
    const extId = new URL(sw.url()).host;
    const index = await waitFor(() => storage(sw, 'owl:index'));
    const status = await storage(sw, 'owl:status');
    console.log(index ? `✔ синхронизация из GitFlic: HEAD ${index.head.slice(0, 7)}, смайлов ${Object.keys(index.emotes).length}` : `✖ синхронизация: ${status?.error}`);
    ok &&= Boolean(index);
    if (!write || !index) return;

    const manage = await ctx.newPage();
    manage.on('dialog', (d) => void d.accept());
    await manage.goto(`chrome-extension://${extId}/manage.html`);
    const key = process.env.GITFLIC_DEPLOY_TOKEN ?? '';
    await manage.fill('.key-form input', 'definitely-wrong-key');
    await manage.click('.key-form button');
    const wrong = await waitFor(() => manage.$('text=Ключ не подошёл'), 30000);
    console.log(`${wrong ? '✔' : '✖'} неверный ключ отклонён (без зависания и окна входа)`);
    ok &&= Boolean(wrong);
    await manage.fill('.key-form input', key);
    await manage.click('.key-form button');
    const accepted = await waitFor(() => manage.$('nav.tabs'), 30000);
    console.log(`${accepted ? '✔' : '✖'} верный ключ принят`);
    ok &&= Boolean(accepted);
    await manage.fill('header input', 'live-check');
    await manage.setInputFiles('.drop input[type=file]', { name: 'owl.png', mimeType: 'image/png', buffer: PNG_1x1 });
    await manage.waitForSelector('.drop img');
    await manage.fill('input[placeholder="CatJam"]', CODE);
    await manage.click('button:has-text("Загрузить в общую базу")');
    const status1 = await waitFor(async () => {
      const t = await manage.textContent('.status');
      return t && !t.endsWith('…') ? t : null;
    });
    console.log(`${status1?.startsWith('Готово') ? '✔' : '✖'} загрузка из браузера: ${status1}`);
    ok &&= Boolean(status1?.startsWith('Готово'));

    const card = manage.locator('.tile', { hasText: CODE });
    await card.waitFor({ timeout: 30000 });
    await card.locator('button:has-text("Удалить")').click();
    const status2 = await waitFor(async () => {
      const t = await manage.textContent('.status');
      return t?.includes('Удалён') && !t.endsWith('…') ? t : null;
    });
    console.log(`${status2?.startsWith('Готово') ? '✔' : '✖'} удаление: ${status2}`);
    ok &&= Boolean(status2?.startsWith('Готово'));
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
    process.exitCode = ok ? 0 : 1;
  }
}

void main();
