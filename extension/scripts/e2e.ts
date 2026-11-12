/**
 * Сквозная проверка в настоящем Chromium с загруженным расширением:
 *   локальный git-сервер (вместо GitFlic) → синхронизация в фоне → чат Twitch (HTML-фикстура)
 *   → кнопка смайлов → загрузка нового смайла через страницу manage → появление в чате.
 * Запуск: npm run e2e
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium, type Page, type Worker } from 'playwright';

// gifenc в Node — CommonJS без именованных ESM-экспортов.
const { GIFEncoder } = createRequire(import.meta.url)('gifenc') as typeof import('gifenc');
import { startGitServer, TEST_KEY } from '../tests/helpers/git-server';

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const IMG = 'img/0123456789abcdef.webp';
const emote = (code: string) =>
  JSON.stringify({ code, image: IMG, animated: false, w: 28, h: 28, author: 'seed', createdAt: '2026-11-12T00:00:00.000Z' });

const TWITCH_FIXTURE = `<!doctype html><html><head><meta charset="utf-8"></head><body style="background:#18181b;color:#fff">
<div class="chat-scrollable-area__message-container" id="chat">
  <div class="chat-line__message" data-a-user="owl_viewer">
    <span class="chat-line__username-container"><span class="chat-line__username"><span class="chat-author__display-name">Owl_Viewer</span></span></span>
    <span>: </span><span class="text-fragment" data-a-target="chat-message-text">hi CatJam there</span>
  </div>
</div>
<div class="chat-input">
  <div data-a-target="chat-input" contenteditable="true" style="min-height:20px;border:1px solid #555"></div>
  <div><button data-a-target="emote-picker-button">😀</button></div>
</div>
</body></html>`;

/** Анимированный GIF: двигающийся круг на прозрачном фоне. */
function makeAnimatedGif(w: number, h: number, frames: number): Buffer {
  const gif = GIFEncoder();
  const palette = [[0, 0, 0, 0], [255, 136, 0, 255], [0, 136, 255, 255]];
  for (let f = 0; f < frames; f++) {
    const index = new Uint8Array(w * h);
    const cx = (w / frames) * f + 20;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = (x - cx) ** 2 + (y - h / 2) ** 2;
        index[y * w + x] = d < 40 * 40 ? 1 : d < 60 * 60 ? 2 : 0;
      }
    gif.writeFrame(index, w, h, { palette, delay: 80, transparent: true, transparentIndex: 0, dispose: 2 });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

/** Число кадров GIF по блокам Image Descriptor после Graphic Control Extension. */
function countGifFrames(b: Buffer): number {
  let n = 0;
  for (let i = 13; i < b.length - 3; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04) n++;
  return n;
}

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? '✔' : '✖'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 20000): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

async function storage(sw: Worker, key: string): Promise<any> {
  // Выполняется внутри сервис-воркера расширения, где есть глобальный chrome.
  return sw.evaluate(async (k) => {
    const api = (globalThis as unknown as { chrome: { storage: { local: { get(k: string): Promise<Record<string, unknown>> } } } }).chrome;
    return (await api.storage.local.get(k))[k];
  }, key);
}

async function main() {
  const server = await startGitServer({
    'meta.json': JSON.stringify({ schema: 1 }),
    [IMG]: Buffer.from('fake').toString(),
    'emotes/CatJam.json': emote('CatJam'),
    'emotes/CatJam2.json': emote('CatJam2'),
    'badges/founder.json': JSON.stringify({ id: 'founder', title: 'Основатель', image: IMG, author: 'seed' }),
    'paints/gold.json': JSON.stringify({ id: 'gold', title: 'Золото', preset: 'shimmer', colors: ['#ffcc00', '#ff5e00'] }),
    'users/twitch/owl_viewer.json': JSON.stringify({ badges: ['founder'], paint: 'gold' }),
  });

  console.log('Сборка расширения с локальным сервером…');
  execSync('npx wxt build', {
    stdio: 'pipe',
    env: {
      ...process.env,
      WXT_GITFLIC_HOST: server.origin,
      WXT_GITFLIC_OWNER: 'owner',
      WXT_GITFLIC_REPO: 'data',
      WXT_GITFLIC_BRANCH: 'master',
      WXT_GITFLIC_USER: 'tester',
    },
  });
  const ext = path.resolve('.output-e2e/chrome-mv3');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-e2e-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });

  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
    const extId = new URL(sw.url()).host;

    // 1. Синхронизация при установке
    const index = await waitFor(() => storage(sw, 'owl:index'));
    check('синхронизация при установке', Boolean(index?.emotes?.CatJam), index ? `HEAD ${index.head.slice(0, 7)}` : String((await storage(sw, 'owl:status'))?.error));

    // 2. Чат Twitch
    await ctx.route('https://www.twitch.tv/**', (r) => r.fulfill({ contentType: 'text/html', body: TWITCH_FIXTURE }));
    const page: Page = await ctx.newPage();
    await page.goto('https://www.twitch.tv/somechannel');
    const emoteImg = await waitFor(() => page.$('img.owl-emote[alt="CatJam"]'));
    check('смайл в сообщении', Boolean(emoteImg));
    check('иконка у ника', (await page.$$('.owl-badges img.owl-badge')).length === 1);
    check('эффект ника', await page.$eval('.chat-author__display-name', (el) => el.classList.contains('owl-paint--shimmer')));

    await page.evaluate(() => {
      const div = document.createElement('div');
      div.className = 'chat-line__message';
      div.setAttribute('data-a-user', 'someone');
      div.innerHTML = '<span class="chat-line__username"><span class="chat-author__display-name">someone</span></span>: <span class="text-fragment">CatJam CatJam</span>';
      document.getElementById('chat')!.append(div);
    });
    check('новое сообщение (MutationObserver)', Boolean(await waitFor(async () => (await page.$$('[data-a-user="someone"] img.owl-emote')).length === 2)));
    check('чужой ник без оформления', !(await page.$('[data-a-user="someone"] .owl-paint, [data-a-user="someone"] .owl-badges')));

    // 3. Кнопка смайлов → вставка в поле ввода
    await page.click('#owl-picker-btn');
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'twitch-picker.png') });
    await page.locator('button[title="CatJam"]').click();
    const inputText = await page.$eval('[data-a-target="chat-input"]', (el) => el.textContent);
    check('кнопка смайлов вставляет код', inputText?.trim() === 'CatJam', JSON.stringify(inputText));

    // 4. Tab-автодополнение
    await page.$eval('[data-a-target="chat-input"]', (el) => (el.textContent = ''));
    await page.click('[data-a-target="chat-input"]');
    await page.keyboard.type('hi Cat');
    const inputValue = () => page.$eval('[data-a-target="chat-input"]', (el) => el.textContent!.replace(/ /g, ' '));
    await page.keyboard.press('Tab');
    const completed = await inputValue();
    check('Tab-автодополнение', completed === 'hi CatJam ', JSON.stringify(completed));
    await page.keyboard.press('Tab');
    const cycled = await inputValue();
    check('повторный Tab — следующий вариант', cycled === 'hi CatJam2 ', JSON.stringify(cycled));

    // 5. Загрузка смайла через страницу manage
    const manage = await ctx.newPage();
    await manage.goto(`chrome-extension://${extId}/manage.html`);
    // Ключ доступа: неверный отклоняется, верный сохраняется
    await manage.fill('.key-form input', 'wrong-key');
    await manage.click('.key-form button');
    check('неверный ключ отклонён', Boolean(await waitFor(() => manage.$('text=Ключ не подошёл'))));
    await manage.fill('.key-form input', TEST_KEY);
    await manage.click('.key-form button');
    check('верный ключ принят', Boolean(await waitFor(() => manage.$('nav.tabs'))));
    check('ключ не попал в сборку', !fs.readdirSync(ext, { recursive: true }).some((f) => /\.(js|html|json)$/.test(String(f)) && fs.readFileSync(path.join(ext, String(f)), 'utf8').includes(TEST_KEY)));
    await manage.fill('header input', 'e2e-tester');
    await manage.setInputFiles('.drop input[type=file]', { name: 'owl.png', mimeType: 'image/png', buffer: PNG_1x1 });
    await manage.waitForSelector('.drop img');
    await manage.fill('input[placeholder="CatJam"]', 'NewOwl');
    await manage.click('button:has-text("Загрузить в общую базу")');
    const status = await waitFor(async () => {
      const t = await manage.textContent('.status').catch(() => null);
      return t && !t.endsWith('…') ? t : null;
    }, 30000);
    check('загрузка через manage', Boolean(status?.startsWith('Готово')), status ?? 'нет статуса');
    check('файл в репозитории', server.files().includes('emotes/NewOwl.json'));
    check('коммит подписан', server.log()[0]?.includes('e2e-tester') ?? false, server.log()[0]);

    // 6. Новый смайл виден в уже открытом чате (обновление кэша → перерисовка)
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.className = 'chat-line__message';
      div.setAttribute('data-a-user', 'later');
      div.innerHTML = '<span class="chat-author__display-name">later</span>: <span class="text-fragment">wow NewOwl</span>';
      document.getElementById('chat')!.append(div);
    });
    check('новый смайл виден в чате', Boolean(await waitFor(() => page.$('[data-a-user="later"] img.owl-emote[alt="NewOwl"]'))));

    if (process.env.SHOTS) {
      await manage.setViewportSize({ width: 1000, height: 900 });
      await manage.screenshot({ path: path.join(process.env.SHOTS, 'manage-emotes.png'), fullPage: true });
      for (const [tab, file] of [['Эффекты ников', 'manage-paints.png'], ['Зрители', 'manage-users.png']]) {
        await manage.click(`nav button:has-text("${tab}")`);
        await manage.screenshot({ path: path.join(process.env.SHOTS, file!), fullPage: true });
      }
      await manage.click('nav button:has-text("Смайлы")');
    }

    // 6b. Разрешение: большая статичная → 112 по высоте, анимация → уменьшенный GIF, иконка → 72×72
    const bigPng = Buffer.from(
      await manage.evaluate(async () => {
        const c = new OffscreenCanvas(600, 400);
        const g = c.getContext('2d')!;
        g.fillStyle = '#f80';
        g.fillRect(0, 0, 600, 400);
        g.fillStyle = '#08f';
        g.beginPath();
        g.arc(300, 200, 150, 0, Math.PI * 2);
        g.fill();
        const b = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
        let s = '';
        for (const x of b) s += String.fromCharCode(x);
        return btoa(s);
      }),
      'base64',
    );
    const upload = async (code: string, buffer: Buffer, name: string, mimeType: string) => {
      await manage.setInputFiles('.upload .drop input[type=file]', { name, mimeType, buffer });
      await manage.waitForSelector('.upload .drop img');
      const info = await manage.textContent('.preview-row');
      await manage.fill('input[placeholder="CatJam"]', code);
      await manage.click('button:has-text("Загрузить в общую базу")');
      await waitFor(async () => (await manage.textContent('.status'))?.includes(`Добавлен смайл ${code}`) && !(await manage.textContent('.status'))!.endsWith('…'), 30000);
      return info ?? '';
    };
    const staticInfo = await upload('BigOwl', bigPng, 'big.png', 'image/png');
    const bigMeta = JSON.parse(server.show('emotes/BigOwl.json').toString());
    check('статичная 600×400 → 168×112 WebP', bigMeta.w === 168 && bigMeta.h === 112 && bigMeta.image.endsWith('.webp') && !bigMeta.animated, `${staticInfo.match(/\d+×\d+ → \d+×\d+/)?.[0]}`);
    const bigFile = server.show(bigMeta.image);
    check('файл — настоящий WebP', bigFile.subarray(8, 12).toString() === 'WEBP', `${Math.ceil(bigFile.length / 1024)} КБ`);

    const animInfo = await upload('AnimOwl', makeAnimatedGif(300, 300, 12), 'anim.gif', 'image/gif');
    const animMeta = JSON.parse(server.show('emotes/AnimOwl.json').toString());
    const animFile = server.show(animMeta.image);
    const gifW = animFile.readUInt16LE(6);
    const gifH = animFile.readUInt16LE(8);
    check('анимация 300×300 → GIF 112×112', animMeta.animated && animMeta.h === 112 && gifW === 112 && gifH === 112, `${animInfo.match(/\d+×\d+ → .*?КБ/)?.[0]}`);
    check('кадры сохранились', countGifFrames(animFile) === 12, `${countGifFrames(animFile)} кадров`);

    await manage.click('nav button:has-text("Иконки")');
    await manage.setInputFiles('.upload .drop input[type=file]', { name: 'b.png', mimeType: 'image/png', buffer: bigPng });
    await manage.waitForSelector('.upload .drop img');
    const badgeInfo = (await manage.textContent('.preview-row')) ?? '';
    const warn = (await manage.textContent('.upload')) ?? '';
    check('иконка 600×400 → 72×48 + предупреждение', badgeInfo.includes('600×400 → 72×48') && warn.includes('не квадратная'), badgeInfo.match(/\d+×\d+ → \d+×\d+/)?.[0]);
    await manage.click('nav button:has-text("Смайлы")');

    // 7. Отказ от не-картинки
    await manage.setInputFiles('.drop input[type=file]', { name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('MZ\x90\x00not an image') });
    check('не-картинка отклонена', Boolean(await waitFor(() => manage.$('text=Это не картинка'))));
  } finally {
    await ctx.close();
    await server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log(failures ? `\nПровалено проверок: ${failures}` : '\nВсе проверки пройдены');
  process.exitCode = failures ? 1 : 0;
}

void main();
