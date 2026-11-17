/**
 * Окна входа из доков OBS (src/obs/popup.ts) в настоящем Chromium. Плагин OBS здесь изображается:
 *   - в главном кадре каждого окна window.close — пустышка (так делает obs-browser в OnLoadStart);
 *   - после загрузки каждой страницы выполняется бандл owl-obs.js (так плагин выполняет стартовый скрипт).
 * Сайты подставные. Запуск: npm run e2e:obs
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium, type Page } from 'playwright';

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? '✔' : '✖'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const html = (body: string) => `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;

const PAGES: Record<string, string> = {
  'https://live.vkvideo.ru/chan/only-chat': html(
    `<p>чат</p><button id="login" onclick="window.open('https://id.vk.com/auth')">Авторизуйтесь</button>
     <button id="link" onclick="window.open('https://live.vkvideo.ru/other')">ссылка</button>
     <script>addEventListener('message', (e) => (window.__got = e.data));</script>`,
  ),
  'https://id.vk.com/auth': html(`<p>Выберите аккаунт</p><script>setTimeout(() => (location.href = 'https://live.vkvideo.ru/app/oauth_redirect?code=1'), 300)</script>`),
  // Конец входа: пустая страница передаёт результат доку и закрывается (close ещё пустышка — бандл не загружен)
  'https://live.vkvideo.ru/app/oauth_redirect?code=1': html(`<script>opener.postMessage('done', '*'); window.close();</script>`),
  'https://live.vkvideo.ru/other': html('<h1>Страница канала</h1>'),
  'https://www.twitch.tv/popout/chan/chat': html(`<p>чат</p><button id="login" onclick="window.open('https://www.twitch.tv/login')">Войти</button>`),
  'https://www.twitch.tv/login': html('<form><input name="login"><button>Войти</button></form>'),
};

async function main() {
  console.log('Сборка owl-obs.js…');
  execSync('npx vite build --config vite.obs.config.ts', { stdio: 'pipe' });
  const bundle = fs.readFileSync('.output/obs/owl-obs.js', 'utf8');

  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const ctx = await browser.newContext();
  try {
    await ctx.addInitScript(() => {
      // Как obs-browser: только главный кадр (в iframe close настоящий — на этом и держится popup.ts)
      if (window === window.top) window.close = () => console.log('OBS browser docks cannot be closed using JavaScript.');
    });
    await ctx.route('**/*', (r) => {
      const body = PAGES[r.request().url()];
      return body ? r.fulfill({ contentType: 'text/html', body }) : r.fulfill({ status: 404, body: '' });
    });
    const runBundle = (p: Page) => p.on('load', () => void p.evaluate(bundle).catch(() => {}));
    ctx.on('page', runBundle);

    // VK Live: вход до конца
    const dock = await ctx.newPage();
    await dock.goto('https://live.vkvideo.ru/chan/only-chat');
    const [login] = await Promise.all([ctx.waitForEvent('page'), dock.click('#login')]);
    const closed = await Promise.race([login.waitForEvent('close').then(() => true), sleep(10_000).then(() => false)]);
    check('VK: окно входа закрылось само после пустой конечной страницы', closed);
    check('VK: док получил результат входа', (await dock.evaluate(() => (window as unknown as { __got?: string }).__got)) === 'done');

    // Ссылка из чата: страница с содержимым не закрывается сама, но close() из страницы работает
    const [link] = await Promise.all([ctx.waitForEvent('page'), dock.click('#link')]);
    await sleep(4000);
    check('окно со страницей канала не закрылось само', !link.isClosed());
    await link.evaluate(() => window.close()).catch(() => {});
    await sleep(500);
    check('window.close() из окна закрывает его', link.isClosed());

    // Сам док закрыть нельзя
    await dock.evaluate(() => window.close());
    await sleep(500);
    check('док не закрывается из JavaScript', !dock.isClosed());

    // Twitch: страница входа с формой остаётся открытой, close() из неё работает
    const twitch = await ctx.newPage();
    await twitch.goto('https://www.twitch.tv/popout/chan/chat');
    const [tLogin] = await Promise.all([ctx.waitForEvent('page'), twitch.click('#login')]);
    await sleep(4000);
    check('Twitch: окно входа с формой не закрылось само', !tLogin.isClosed());
    await tLogin.evaluate(() => window.close()).catch(() => {});
    await sleep(500);
    check('Twitch: window.close() из окна входа закрывает его', tLogin.isClosed());
  } finally {
    await browser.close();
  }
  console.log(failures ? `\nПровалено проверок: ${failures}` : '\nВсе проверки пройдены');
  process.exitCode = failures ? 1 : 0;
}

void main();
