/**
 * Сквозная проверка в настоящем Chromium с загруженным расширением:
 *   локальный git-сервер (вместо GitFlic) → синхронизация в фоне → чат Twitch (HTML-фикстура)
 *   → кнопка смайлов → загрузка нового смайла через страницу manage → появление в чате.
 * Запуск: npm run e2e
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
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
  <div data-a-target="chat-input" contenteditable="true" role="textbox" style="min-height:20px;border:1px solid #555"></div>
  <div><button data-a-target="emote-picker-button">😀</button></div>
  <div class="chat-input__buttons-container"><div>0 · 41 550</div><div class="right"><div><div><button data-a-target="chat-settings">⚙</button></div></div><button data-a-target="chat-send-button">Чат</button></div></div>
</div>
<script>
  // Редактор «как Slate»: текст живёт в модели и меняется только через beforeinput.
  // Изменения DOM в обход модели (execCommand без beforeinput) откатываются —
  // в чат ушло бы содержимое модели, а не то, что было видно на экране.
  (() => {
    const ed = document.querySelector('[data-a-target="chat-input"]');
    let model = '';
    const render = () => {
      ed.textContent = model;
      if (document.activeElement === ed) {
        const r = document.createRange();
        r.selectNodeContents(ed);
        r.collapse(false);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
      }
    };
    ed.addEventListener('beforeinput', (e) => {
      e.preventDefault();
      if (e.inputType === 'insertText') model += e.data;
      else if (e.inputType === 'deleteContentBackward') model = model.slice(0, -1);
      render();
    });
    ed.addEventListener('input', render);
    window.__owlModel = () => model;
    window.__owlReset = () => { model = ''; render(); };
  })();
</script>
</body></html>`;

const VK_FIXTURE = `<!doctype html><html><head><meta charset="utf-8"></head><body style="background:#18181b;color:#fff">
<div class="Chat_root_tUBSs"><div class="ChatBoxBase_root_k1P9S" id="chat">
  <div class="ChatMessage_root_UHMEJ MessagesList_message_mHGaj undefined" data-test-id="ChatMessage:root" data-role="messageContainer" data-message-id="1"><div class="ChatMessage_message_r1jzC"><div class="ChatMessage_publishTime_EzWt_">22:13</div><div data-role="messageMainContent"><div class="ChatMessageAuthorPanel_author_qc2nK" data-role="messageAuthor" data-test-id="ChatMessage:author"><div class="ChatBadge_root_IHNlp" title="Модератор"><div class="Badge_small_BOk2J"><img alt="Модератор" class="ChatBadge_image_FMyoR" height="16" width="16" src="data:,"></div></div> <span class="ChatMessageAuthorPanel_name_w3ZOm" style="color: rgb(184, 170, 255);">Данил Кузнецов.:</span></div><span class="BlockRenderer_markup_Wtipg BlockRenderer_noIndent_yWqyP" data-role="markup">всем привет CatJam</span></div></div></div>
</div></div>
<div class="ChatPublisher_root_xCqwT" id="chat-pub-root"><div class="Publisher_root_OEAeu">
  <div class="Publisher_editorWrapper_ruJa3"><div class="Publisher_editor_lrEMS"><div class="codex-editor"><div class="ce-block"><div class="ce-paragraph cdx-block" contenteditable="true" style="min-height:20px;border:1px solid #555"></div></div></div></div></div>
  <div class="Publisher_actionsContainer_nXHDH"><div class="Publisher_smileContainer_MjJHi"><button>☺</button></div></div>
</div><div class="ChatPublisher_footer_e2e"><div>4,7K</div><div class="ChatPublisher_actions_e2e"><button>🚀</button><div><button>⚙</button></div></div></div></div>
<script>
  // Как VK в режиме ответа: нажатие мыши вне блока ввода отменяет ответ и стирает набранный текст
  // (жалоба 14.11.2026: окно смайлов совы было вне блока, и выбор смайла сбрасывал ответ).
  // Слушаем в фазе перехвата — так остановка всплытия не помогла бы, нужен именно «клик внутри».
  (() => {
    const root = document.getElementById('chat-pub-root');
    document.addEventListener('mousedown', (e) => {
      if (!window.__vkReply || root.contains(e.target)) return;
      window.__vkReply = false;
      document.querySelector('.ce-paragraph').innerHTML = '';
    }, true);
  })();
</script>
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

/**
 * Подставной BetterTTV + api.ivr.fi + CDN на одном локальном сервере.
 * Глобальных смайлов 40 — чтобы было видно, что картинки не качаются заранее.
 * CatJam есть и в BetterTTV — в чате должен победить смайл Owl Smile.
 */
const bttvId = (n: number) => n.toString(16).padStart(24, 'b');
function startBttvServer(): Promise<{ origin: string; imageHits: () => number; close: () => Promise<void> }> {
  const global = [
    ...Array.from({ length: 40 }, (_, i) => ({ id: bttvId(100 + i), code: `Glob${i}`, imageType: 'png', animated: false })),
    { id: bttvId(1), code: 'CatJam', imageType: 'png', animated: false },
    { id: bttvId(2), code: 'c!', imageType: 'png', animated: false, modifier: true },
  ];
  const users: Record<string, { id: string; displayName: string; emote: string }> = {
    somechannel: { id: '777', displayName: 'SomeChannel', emote: 'ChanEmote' },
    vkchan: { id: '778', displayName: 'VkChan', emote: 'VkChanEmote' },
  };
  let hits = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/3/cached/emotes/global') return json(200, global);
    if (url.pathname === '/v2/twitch/user') {
      const login = url.searchParams.get('login') ?? '';
      const u = users[login];
      return json(200, u ? [{ login, id: u.id, displayName: u.displayName }] : []);
    }
    const ch = /^\/3\/cached\/users\/twitch\/(\d+)$/.exec(url.pathname);
    if (ch) {
      const u = Object.values(users).find((x) => x.id === ch[1]);
      return u ? json(200, { id: 'x', channelEmotes: [{ id: bttvId(Number(u.id)), code: u.emote, imageType: 'png', animated: false }], sharedEmotes: [] }) : json(404, { message: 'user not found' });
    }
    if (/^\/emote\/[0-9a-f]{24}\/[123]x\.webp$/.test(url.pathname)) {
      hits++;
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG_1x1);
    }
    json(404, { message: 'not found' });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ origin: `http://127.0.0.1:${port}`, imageHits: () => hits, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

async function storage(sw: Worker, key: string): Promise<any> {
  // Выполняется внутри сервис-воркера расширения, где есть глобальный chrome.
  return sw.evaluate(async (k) => {
    const api = (globalThis as unknown as { chrome: { storage: { local: { get(k: string): Promise<Record<string, unknown>> } } } }).chrome;
    return (await api.storage.local.get(k))[k];
  }, key);
}

type SyncArea = { get(k: string | null): Promise<Record<string, unknown>>; set(i: Record<string, unknown>): Promise<void>; remove(k: string[]): Promise<void> };

/** Личные настройки (chrome.storage.sync, ключи owl:p:<поле>); null — вернуть все по умолчанию. */
async function setPrefs(sw: Worker, prefs: Record<string, unknown> | null): Promise<void> {
  await sw.evaluate(async (p) => {
    const area = (globalThis as unknown as { chrome: { storage: { sync: SyncArea } } }).chrome.storage.sync;
    if (p) await area.set(Object.fromEntries(Object.entries(p).map(([k, v]) => [`owl:p:${k}`, v])));
    else await area.remove(Object.keys(await area.get(null)).filter((k) => k.startsWith('owl:p:')));
  }, prefs);
}

async function main() {
  const server = await startGitServer({
    'meta.json': JSON.stringify({ schema: 1 }),
    [IMG]: Buffer.from('fake').toString(),
    'emotes/CatJam.json': emote('CatJam'),
    'emotes/CatJam2.json': emote('CatJam2'),
    'badges/founder.json': JSON.stringify({ id: 'founder', title: 'Основатель', image: IMG, author: 'seed' }),
    'badges-info/founder.json': JSON.stringify({ description: 'С совятником с первого стрима' }),
    'paints/gold.json': JSON.stringify({ id: 'gold', title: 'Золото', preset: 'shimmer', colors: ['#ffcc00', '#ff5e00'] }),
    'users/twitch/owl_viewer.json': JSON.stringify({ badges: ['founder'], paint: 'gold' }),
    'users/vk/данил кузнецов..json': JSON.stringify({ badges: ['founder'], paint: 'gold' }),
    'nameplates/stars.json': JSON.stringify({ id: 'stars', title: 'Звёзды', kind: 'emoji', emoji: '⭐🦉', opacity: 0.5, author: 'seed' }),
    'profiles/twitch/owl_viewer.json': JSON.stringify({
      nameplate: 'stars', about: 'Совиный модератор', pronouns: 'он', accent: '#3a1d6e',
      links: [{ title: 'Телеграм', url: 'https://t.me/owl' }], favEmotes: ['CatJam'], alsoOn: { platform: 'vk', nick: 'данил кузнецов.' },
      future: 'поле будущей версии',
    }),
    'nameplates/bolts.json': JSON.stringify({
      id: 'bolts', title: 'Молнии', kind: 'pattern', pattern: 'lightning', colors: ['#bf94ff'], glow: 0.6, shape: 'pill', anim: 'slide', speed: 5,
      alt: { color: '#00e5ff', checker: true }, author: 'seed',
    }),
    'profiles/vk/данил кузнецов..json': JSON.stringify({ nameplate: 'bolts', status: 'Смотрю стрим', birthday: '01-15' }),
  });

  const bttvServer = await startBttvServer();

  console.log('Сборка расширения с локальным сервером…');
  execSync('npx wxt build', {
    stdio: 'pipe',
    env: {
      ...process.env,
      WXT_BTTV_TEST_HOST: bttvServer.origin,
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
    const plate = await page.$eval('.chat-author__display-name', (el) => ({
      cls: el.classList.contains('owl-plate'),
      before: getComputedStyle(el, '::before').backgroundImage.startsWith('url("data:image/svg+xml'),
      text: el.textContent,
    }));
    check('подложка под ником (эмодзи) вместе с эффектом', plate.cls && plate.before && plate.text === 'Owl_Viewer', JSON.stringify(plate));

    // Профиль Owl на Twitch: блок Owl внутри карточки зрителя Twitch (сама карточка остаётся Twitch-овской)
    await page.evaluate(() => {
      const w = window as unknown as { __native: number };
      w.__native = 0;
      // Как Twitch: по клику на ник чуть позже открывается его карточка зрителя
      document.getElementById('chat')!.addEventListener('click', (e) => {
        const target = e.target as Element;
        const m = target.closest('[data-a-user]');
        if (!m || !target.closest('.chat-author__display-name')) return;
        w.__native++;
        setTimeout(() => {
          document.querySelector('.viewer-card-layer')?.remove();
          const layer = document.createElement('div');
          layer.className = 'viewer-card-layer';
          layer.style.cssText = 'position:fixed;left:20px;top:40px;width:340px;background:#18181b;border:1px solid #444;border-radius:6px;color:#fff;font:13px sans-serif';
          layer.innerHTML =
            '<div class="viewer-card" data-a-target="viewer-card"><div class="viewer-card-header__banner" style="height:60px;background:#333;padding:8px">' +
            '<b class="viewer-card-header__display-name"></b></div><div class="viewer-card__body" style="padding:8px">Значки · Подарить подписку · Отслеживать</div></div>';
          layer.querySelector('.viewer-card-header__display-name')!.textContent = m.getAttribute('data-a-user');
          document.body.append(layer);
        }, 150);
      });
    });
    const nativeClicks = () => page.evaluate(() => (window as unknown as { __native: number }).__native);
    const blockText = () => page.evaluate(() => document.querySelector('.viewer-card .owl-vc-host')?.shadowRoot?.textContent ?? null);
    await page.click('[data-a-user="owl_viewer"] .chat-author__display-name');
    const shown = await waitFor(async () => ((await blockText())?.includes('Совиный модератор') ? await blockText() : null), 3000);
    const twitchBody = await page.textContent('.viewer-card__body');
    check('профиль Twitch: блок Owl внутри карточки Twitch, она сама на месте', Boolean(shown) && (await nativeClicks()) === 1 && Boolean(twitchBody?.includes('Подарить подписку')));
    check('профиль: «Пользователь Owl Smile», ссылки с меткой соцсети, любимые смайлы, другая площадка',
      Boolean(shown?.includes('Пользователь Owl Smile') && shown.includes('TG') && shown.includes('Телеграм') && shown.includes('Любимые смайлы') && shown.includes('Также на VK Live')),
      shown?.slice(0, 120) ?? '');
    check('профиль: что носит — эффект и подложка', Boolean(shown?.includes('эффект: Золото') && shown.includes('подложка: Звёзды')));
    const cardBadge = await page.evaluate(() => document.querySelector('.viewer-card .owl-vc-host')!.shadowRoot!.querySelector('.badge')?.textContent ?? '');
    check('профиль: иконка с описанием', cardBadge === 'ОсновательС совятником с первого стрима', cardBadge);
    check('иконка в чате: описание в подсказке', (await page.getAttribute('.owl-badges img.owl-badge', 'title')) === 'Основатель — С совятником с первого стрима');
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'twitch-card.png') });
    // «Упомянуть» вставляет @логин в поле ввода (в модель редактора, как у Slate)
    await page.evaluate(() => (window as unknown as { __owlReset(): void }).__owlReset());
    await page.evaluate(() => {
      const btn = [...document.querySelector('.viewer-card .owl-vc-host')!.shadowRoot!.querySelectorAll('button')].find((b) => b.textContent === 'Упомянуть');
      btn!.click();
    });
    const mentioned = await waitFor(
      async () => ((await page.evaluate(() => (window as unknown as { __owlModel(): string }).__owlModel())) === '@owl_viewer ' ? 'ok' : null),
      3000,
    );
    check('профиль: «Упомянуть» вставляет @ник', Boolean(mentioned), JSON.stringify(await page.evaluate(() => (window as unknown as { __owlModel(): string }).__owlModel())));
    await page.evaluate(() => (window as unknown as { __owlReset(): void }).__owlReset());

    await page.evaluate(() => {
      const div = document.createElement('div');
      div.className = 'chat-line__message';
      div.setAttribute('data-a-user', 'plain_viewer');
      div.innerHTML = '<span class="chat-line__username"><span class="chat-author__display-name">plain_viewer</span></span>: <span class="text-fragment">привет</span>';
      document.getElementById('chat')!.append(div);
    });
    await page.waitForTimeout(200);
    await page.click('[data-a-user="plain_viewer"] .chat-author__display-name');
    const plainBlock = await waitFor(async () => ((await blockText())?.includes('Owl Smile · сообщений в этом чате') ? await blockText() : null), 3000);
    check('профиль: у неоформленного — компактная строка с его сообщениями', Boolean(plainBlock?.includes('сообщений в этом чате: 1') && !plainBlock.includes('Пользователь Owl Smile')), plainBlock?.slice(0, 80) ?? '');
    await page.evaluate(() => {
      document.querySelector('[data-a-user="plain_viewer"]')!.remove();
      document.querySelector('.viewer-card-layer')?.remove();
    });

    await page.evaluate(() => {
      const div = document.createElement('div');
      div.className = 'chat-line__message';
      div.setAttribute('data-a-user', 'someone');
      div.innerHTML = '<span class="chat-line__username"><span class="chat-author__display-name">someone</span></span>: <span class="text-fragment">CatJam CatJam</span>';
      document.getElementById('chat')!.append(div);
    });
    check('новое сообщение (MutationObserver)', Boolean(await waitFor(async () => (await page.$$('[data-a-user="someone"] img.owl-emote')).length === 2)));
    check('чужой ник без оформления', !(await page.$('[data-a-user="someone"] .owl-paint, [data-a-user="someone"] .owl-badges')));

    // 3. Кнопка смайлов (по умолчанию — под полем ввода, перед шестерёнкой) → вставка в поле ввода
    const nextToOwl = (p: Page) => p.evaluate(() => document.getElementById('owl-picker-btn')?.nextElementSibling?.textContent ?? '');
    check('Twitch: кнопка под полем ввода, перед шестерёнкой', Boolean(await waitFor(async () => (await nextToOwl(page)) === '⚙')), await nextToOwl(page));
    await page.click('#owl-picker-btn');
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'twitch-picker.png') });
    await page.locator('button[title="CatJam"]').click();
    // Проверяем модель редактора — то, что реально уйдёт в чат.
    const model = () => page.evaluate(() => (window as unknown as { __owlModel(): string }).__owlModel());
    const picked = await waitFor(async () => ((await model()) === 'CatJam ' ? 'ok' : null), 3000);
    check('кнопка смайлов вставляет код (в модель редактора)', Boolean(picked), JSON.stringify(await model()));

    // 4. Tab-автодополнение
    await page.evaluate(() => (window as unknown as { __owlReset(): void }).__owlReset());
    await page.click('[data-a-target="chat-input"]');
    await page.keyboard.type('hi Cat');
    const inputValue = model;
    await page.keyboard.press('Tab');
    const completed = await inputValue();
    check('Tab-автодополнение (в модель редактора)', completed === 'hi CatJam ', JSON.stringify(completed));
    await page.keyboard.press('Tab');
    const cycled = await inputValue();
    check('повторный Tab — следующий вариант', cycled === 'hi CatJam2 ', JSON.stringify(cycled));
    await page.keyboard.type('x');
    check('дальше можно печатать', (await model()) === 'hi CatJam2 x', JSON.stringify(await model()));

    // 4a. Личные настройки: применяются в открытом чате без перезагрузки
    const emoteHeight = () => page.$eval('img.owl-emote[alt="CatJam"]', (el) => el.getBoundingClientRect().height).catch(() => 0);
    await setPrefs(sw, { emoteSize: 40 });
    check('настройки: размер смайла', Boolean(await waitFor(async () => (await emoteHeight()) === 40, 5000)), `${await emoteHeight()} px`);
    await setPrefs(sw, { enabled: false });
    const off = await waitFor(async () => !(await page.$('img.owl-emote, .owl-badges, .owl-paint, #owl-picker-btn')), 5000);
    check('настройки: выключатель убирает всё', Boolean(off));
    check('настройки: текст сообщения вернулся', (await page.textContent('[data-a-user="owl_viewer"] .text-fragment')) === 'hi CatJam there');
    await setPrefs(sw, { enabled: true });
    check('настройки: включение возвращает смайлы, иконки и кнопку', Boolean(await waitFor(async () =>
      (await page.$$('img.owl-emote')).length >= 3 && Boolean(await page.$('.owl-badges')) && Boolean(await page.$('#owl-picker-btn')), 5000)));
    await setPrefs(sw, { hideUsers: ['someone'] });
    check('настройки: сообщение скрытого зрителя свёрнуто', Boolean(await waitFor(() => page.$('[data-a-user="someone"].owl-collapsed .owl-reveal'), 5000)));
    await setPrefs(sw, null);
    check('настройки: сброс', Boolean(await waitFor(async () => !(await page.$('.owl-collapsed')) && (await emoteHeight()) === 28, 5000)));

    const options = await ctx.newPage();
    await options.goto(`chrome-extension://${extId}/options.html`);
    check('страница настроек: предпросмотр со смайлом', Boolean(await waitFor(() => options.$('.preview-chat img.owl-emote[alt="CatJam"]'))));
    await options.click('nav button:has-text("Фильтры")');
    await options.fill('textarea[aria-label="Скрывать зрителей"]', 'Nightbot');
    check('страница настроек: предпросмотр сворачивает скрытого', Boolean(await waitFor(() => options.$('.preview-chat [data-a-user="nightbot"].owl-collapsed'), 3000)));
    const savedHide = await waitFor(async () => {
      const v = await sw.evaluate(async () =>
        (await (globalThis as unknown as { chrome: { storage: { sync: SyncArea } } }).chrome.storage.sync.get('owl:p:hideUsers'))['owl:p:hideUsers']);
      return JSON.stringify(v) === '["nightbot"]' ? 'ok' : null;
    }, 3000);
    check('страница настроек: настройка сохранилась', Boolean(savedHide));
    if (process.env.SHOTS) {
      await options.setViewportSize({ width: 1100, height: 900 });
      await options.screenshot({ path: path.join(process.env.SHOTS, 'options.png'), fullPage: true });
    }
    await options.close();
    await setPrefs(sw, null);

    // 4b. VK Live (разметка с live.vkvideo.ru, редактор Editor.js — обычный contenteditable)
    await ctx.route('https://live.vkvideo.ru/**', (r) => r.fulfill({ contentType: 'text/html', body: VK_FIXTURE }));
    const vk: Page = await ctx.newPage();
    await vk.goto('https://live.vkvideo.ru/somechannel');
    check('VK: смайл в сообщении', Boolean(await waitFor(() => vk.$('[data-role="markup"] img.owl-emote[alt="CatJam"]'))));
    check('VK: иконка перед ником', Boolean(await vk.$('[data-role="messageAuthor"] .owl-badges + [class*="ChatMessageAuthorPanel_name_"]')));
    check('VK: эффект на ник с кириллицей', await vk.$eval('[class*="ChatMessageAuthorPanel_name_"]', (el) => el.classList.contains('owl-paint--shimmer')));
    check('VK: подложка, ник не изменился', await vk.$eval('[class*="ChatMessageAuthorPanel_name_"]', (el) => el.classList.contains('owl-plate') && el.textContent === 'Данил Кузнецов.:'));
    const vkPlate = await vk.$eval('[class*="ChatMessageAuthorPanel_name_"]', (el) => ({
      cls: ['owl-plate--pattern', 'owl-plate--pill', 'owl-plate--anim-slide'].every((c) => el.classList.contains(c)),
      before: getComputedStyle(el, '::before').backgroundImage.startsWith('url("data:image/svg+xml'),
      anim: getComputedStyle(el, '::before').animationName,
    }));
    check('VK: подложка-узор (молнии, шахматка, плашка, плывёт)', vkPlate.cls && vkPlate.before && vkPlate.anim === 'owl-plate-slide', JSON.stringify(vkPlate));
    await vk.click('[data-message-id="1"] [class*="ChatMessageAuthorPanel_name_"]');
    const vkCard = await waitFor(() => vk.evaluate(() => {
      const host = document.querySelector('.owl-card-host');
      return host ? { inside: host.parentElement?.id === 'chat-pub-root', name: host.shadowRoot!.querySelector('.name')!.textContent } : null;
    }), 3000);
    check('VK: карточка профиля, внутри блока ввода, ник без двоеточия', Boolean(vkCard?.inside && vkCard.name === 'Данил Кузнецов.'), JSON.stringify(vkCard));
    const vkCardText = await vk.evaluate(() => document.querySelector('.owl-card-host')!.shadowRoot!.textContent ?? '');
    check('VK: в карточке статус, день рождения, «Пользователь Owl Smile», сообщения в чате',
      ['Смотрю стрим', 'День рождения 15 января', 'Пользователь Owl Smile', 'Сообщений в этом чате: 1'].every((t) => vkCardText.includes(t)), vkCardText.slice(0, 160));
    if (process.env.SHOTS) await vk.screenshot({ path: path.join(process.env.SHOTS, 'vk-card.png') });
    await vk.keyboard.press('Escape');
    check('VK: Esc закрывает карточку', Boolean(await waitFor(async () => !(await vk.$('.owl-card-host')), 2000)));
    await vk.evaluate(() => {
      const tpl = document.querySelector('[data-role="messageContainer"]')!.cloneNode(true) as HTMLElement;
      tpl.querySelectorAll('.owl-badges, img.owl-emote').forEach((n) => n.remove());
      const name = tpl.querySelector('[class*="ChatMessageAuthorPanel_name_"]') as HTMLElement;
      name.className = 'ChatMessageAuthorPanel_name_w3ZOm';
      name.removeAttribute('style');
      name.textContent = 'Кто-то другой:';
      tpl.querySelector('[data-role="markup"]')!.textContent = 'CatJam2 ура';
      tpl.dataset.messageId = '2';
      delete tpl.dataset.owl;
      document.getElementById('chat')!.append(tpl);
    });
    check('VK: новое сообщение', Boolean(await waitFor(() => vk.$('[data-message-id="2"] img.owl-emote[alt="CatJam2"]'))));
    check('VK: чужой ник без оформления', !(await vk.$('[data-message-id="2"] .owl-badges, [data-message-id="2"] .owl-paint')));

    // Личные настройки на VK: свои размеры, ники с кириллицей и пробелами, своё время у площадки
    const vkEmoteH = () => vk.$eval('[data-message-id="2"] img.owl-emote', (el) => el.getBoundingClientRect().height).catch(() => 0);
    check('VK, настройки: размер смайла по умолчанию 32', (await vkEmoteH()) === 32, `${await vkEmoteH()} px`);
    await setPrefs(sw, { emoteSize: 20, emoteSizeVk: 24, myNicks: { twitch: '', vk: 'Кто-то другой' }, hideUsers: ['Данил Кузнецов.'], timestamps: true });
    check('VK, настройки: свой размер смайла', Boolean(await waitFor(async () => (await vkEmoteH()) === 24, 5000)), `${await vkEmoteH()} px`);
    check('VK, настройки: скрытый зритель с кириллицей и точкой', Boolean(await waitFor(() => vk.$('[data-message-id="1"].owl-collapsed'), 5000)));
    check('VK, настройки: свои сообщения не подсвечиваются', !(await vk.$('[data-message-id="2"].owl-hl')));
    check('VK, настройки: время не дублирует время VK', !(await vk.$('.owl-time')));
    check('VK, настройки: Twitch получил свой размер', Boolean(await waitFor(async () => (await emoteHeight()) === 20, 5000)), `${await emoteHeight()} px`);
    await setPrefs(sw, null);
    check('VK, настройки: сброс', Boolean(await waitFor(async () => !(await vk.$('.owl-collapsed')) && (await vkEmoteH()) === 32, 5000)));
    check('VK: кнопка под полем ввода, между ракетой и шестерёнкой', Boolean(await waitFor(async () => (await nextToOwl(vk)) === '⚙')), await nextToOwl(vk));
    await setPrefs(sw, { pickerPlace: 'input' });
    check('VK: настройка «в поле ввода» — рядом с их смайлами', Boolean(await waitFor(() => vk.$('#owl-picker-btn + [class*="Publisher_smileContainer_"]'), 5000)));
    await setPrefs(sw, { pickerPlace: 'toolbar' });
    check('VK: и обратно под поле', Boolean(await waitFor(async () => (await nextToOwl(vk)) === '⚙', 5000)));
    await vk.click('#owl-picker-btn');
    check('VK: «Недавние» помнят смайл из Twitch', Boolean(await vk.$('text=Недавние')));
    await vk.locator('button[title="CatJam"]').first().click();
    const vkText = () => vk.$eval('.ce-paragraph', (el) => el.textContent!.replace(/ /g, ' '));
    check('VK: кнопка смайлов вставляет код', Boolean(await waitFor(async () => ((await vkText()) === 'CatJam ' ? 'ok' : null), 3000)), JSON.stringify(await vkText()));
    await vk.keyboard.type('Ca');
    await vk.keyboard.press('Tab');
    check('VK: Tab-автодополнение', (await vkText()) === 'CatJam CatJam ', JSON.stringify(await vkText()));

    // 4a. Режим ответа: в поле ввода чип с ником (нередактируемый) и текст; после клика по окну смайлов
    //     каретка оказывается в начале поля — код всё равно должен встать в конец сообщения
    const setReply = (html: string, caret: 'start' | 'end') =>
      vk.evaluate(
        ({ html, caret }) => {
          (window as unknown as { __vkReply: boolean }).__vkReply = html.length > 0; // режим ответа включён
          const p = document.querySelector('.ce-paragraph') as HTMLElement;
          p.innerHTML = html;
          p.focus();
          const r = document.createRange();
          r.selectNodeContents(p);
          r.collapse(caret === 'start');
          const sel = getSelection()!;
          sel.removeAllRanges();
          sel.addRange(r);
        },
        { html, caret },
      );
    const CHIP = '<span class="mention" contenteditable="false">@Леся</span>';
    await setReply(`${CHIP}&nbsp;привет`, 'start');
    await vk.click('#owl-picker-btn');
    await vk.locator('button[title="CatJam"]').first().click();
    check('VK, ответ: смайл из окна — в конец, ник на месте', Boolean(await waitFor(async () => ((await vkText()) === '@Леся привет CatJam ' ? 'ok' : null), 3000)), JSON.stringify(await vkText()));
    check('VK, ответ: чип с ником цел', (await vk.locator('.ce-paragraph .mention').count()) === 1);
    check('VK, ответ: выбор смайла в окне не отменил ответ', await vk.evaluate(() => (window as unknown as { __vkReply: boolean }).__vkReply === true));
    await vk.click('#owl-picker-btn');
    check('VK: окно смайлов — внутри блока ввода', await vk.evaluate(() => document.querySelector('.owl-picker-host')?.parentElement?.id === 'chat-pub-root'));
    // Плеер VK с большим z-index поверх всего (жалоба 14.11.2026: он перекрывал окно смайлов)
    const onTop = await vk.evaluate(() => {
      const player = document.createElement('div');
      player.id = 'fake-player';
      player.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000c';
      document.body.append(player);
      const host = document.querySelector<HTMLElement>('.owl-picker-host')!;
      const r = host.shadowRoot!.querySelector('.panel')!.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      player.remove();
      return { popover: host.matches(':popover-open'), topIsPicker: top === host };
    });
    check('VK: окно смайлов в верхнем слое, поверх плеера', onTop.popover && onTop.topIsPicker, JSON.stringify(onTop));
    await vk.locator('.panel input').fill('Cat');
    await vk.locator('.panel input').press('Escape');
    check('VK, ответ: поиск и Esc в окне не трогают ответ', await vk.evaluate(() => (window as unknown as { __vkReply: boolean }).__vkReply === true) && (await vkText()).startsWith('@Леся привет'), JSON.stringify(await vkText()));

    await setReply(`привет ${CHIP}`, 'start');
    await vk.click('#owl-picker-btn');
    await vk.locator('button[title="CatJam"]').first().click();
    check('VK, ответ: сообщение кончается ником — смайл после ника', Boolean(await waitFor(async () => ((await vkText()) === 'привет @Леся CatJam ' ? 'ok' : null), 3000)), JSON.stringify(await vkText()));

    await setReply(`${CHIP}Ca`, 'end');
    await vk.keyboard.press('Tab');
    check('VK, ответ: Tab дополняет слово вплотную к нику', (await vkText()) === '@Леся CatJam ', JSON.stringify(await vkText()));

    await setReply('@ca', 'end');
    await vk.keyboard.press('Tab');
    check('VK: Tab после «@» оставлен площадке (ник не подменяется смайлом)', !(await vkText()).includes('CatJam'), JSON.stringify(await vkText()));
    await setReply('', 'end');

    // 4c. BetterTTV на Twitch: смайлы открытого канала и глобальные, в чате и во второй вкладке окна
    const addTwitchMessage = (user: string, text: string) =>
      page.evaluate(({ user, text }) => {
        const div = document.createElement('div');
        div.className = 'chat-line__message';
        div.setAttribute('data-a-user', user);
        div.innerHTML = `<span class="chat-author__display-name">${user}</span>: <span class="text-fragment">${text}</span>`;
        document.getElementById('chat')!.append(div);
      }, { user, text });
    // Страница https, а подставной CDN — http: Chrome поднимает адрес картинки до https, поэтому картинки
    // отдаём перехватом в самом браузере и считаем запросы
    let imageHits = 0;
    await ctx.route(/\/emote\/[0-9a-f]{24}\/[123]x\.webp$/, (r) => {
      imageHits++;
      return r.fulfill({ contentType: 'image/png', body: PNG_1x1 });
    });
    await waitFor(() => storage(sw, 'bttv:ch:somechannel').then((c) => c?.at > 0));
    await addTwitchMessage('bttvfan', 'ChanEmote Glob3 CatJam');
    const bttvImgs = await waitFor(async () => {
      const imgs = await page.$$eval('[data-a-user="bttvfan"] img.owl-emote', (els) => els.map((e) => ({ alt: e.getAttribute('alt'), src: e.getAttribute('src')!, srcset: e.getAttribute('srcset') })));
      return imgs.length === 3 ? imgs : null;
    });
    check('BTTV: смайлы канала и глобальные в сообщении Twitch', Boolean(bttvImgs?.[0]?.src.includes(bttvId(777)) && bttvImgs?.[1]?.src.includes(bttvId(103)) && bttvImgs?.[0]?.srcset?.includes('2x.webp 2x')), JSON.stringify(bttvImgs?.map((i) => i.alt)));
    check('BTTV: при совпадении кода побеждает Owl Smile', Boolean(bttvImgs?.[2]?.src.startsWith('data:')), bttvImgs?.[2]?.src.slice(0, 30));

    // Подсказка при наведении: код, откуда смайл, кто загрузил — в верхнем слое.
    // Поддельная карточка Twitch (клики по никам в шагах выше) закрыта — как закрыл бы её Twitch
    await page.evaluate(() => document.querySelectorAll('.viewer-card-layer').forEach((n) => n.remove()));
    const tipFor = async (alt: string) => {
      await page.mouse.move(0, 0);
      await page.hover(`[data-a-user="bttvfan"] img.owl-emote[alt="${alt}"]`);
      return waitFor(() => page.evaluate(() => {
        const host = document.querySelector('.owl-tip-host');
        const r = host?.shadowRoot;
        if (!r) return null;
        return {
          top: host!.matches(':popover-open'),
          code: r.querySelector('.code')?.textContent, src: r.querySelector('.src')?.textContent, author: r.querySelector('.author')?.textContent ?? null,
        };
      }), 3000);
    };
    const owlTip = await tipFor('CatJam');
    check('подсказка смайла Owl: код, «🦉 Owl Smile», кто загрузил и когда',
      owlTip?.code === 'CatJam' && owlTip.src === '🦉 Owl Smile' && owlTip.author === 'Загрузил(а): seed, 12.11.2026' && owlTip.top, JSON.stringify(owlTip));
    const chanTip = await tipFor('ChanEmote');
    check('подсказка смайла BetterTTV канала: источник и автор (канал)',
      chanTip?.src === 'BetterTTV · канал SomeChannel' && chanTip.author === 'Автор: SomeChannel', JSON.stringify(chanTip));
    const globTip = await tipFor('Glob3');
    check('подсказка глобального смайла BetterTTV', globTip?.src === 'BetterTTV · глобальный', JSON.stringify(globTip));
    await page.mouse.move(0, 0);
    await page.hover('[data-a-user="bttvfan"] img.owl-emote[alt="CatJam"]');
    await waitFor(() => page.$('.owl-tip-host'), 2000);
    for (let i = 0; i < 3; i++) {
      await addTwitchMessage(`flood${i}`, 'новое сообщение');
      await page.evaluate(() => document.dispatchEvent(new Event('scroll')));
    }
    await page.waitForTimeout(300);
    check('подсказка не исчезает от новых сообщений в чате', Boolean(await page.$('.owl-tip-host')));
    await page.mouse.move(0, 0);
    check('подсказка исчезает, когда мышь ушла', Boolean(await waitFor(async () => !(await page.$('.owl-tip-host')), 2000)));
    if (process.env.SHOTS) {
      await page.hover('[data-a-user="bttvfan"] img.owl-emote[alt="CatJam"]');
      await page.screenshot({ path: path.join(process.env.SHOTS, 'twitch-tip.png') });
      await page.mouse.move(0, 0);
    }
    const drawn = await waitFor(() => page.$eval('[data-a-user="bttvfan"] img.owl-emote[alt="ChanEmote"]', (e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0));
    check('BTTV: картинка смайла загрузилась и нарисована', Boolean(drawn));
    const hitsBeforePicker = imageHits + bttvServer.imageHits();
    check('BTTV: картинки заранее не качаются (только видимые в чате)', hitsBeforePicker > 0 && hitsBeforePicker <= 4, `${hitsBeforePicker} запросов картинок при 41 смайле в списках`);

    await page.click('#owl-picker-btn');
    await page.locator('.tabs button[data-tab="bttv"]').click();
    const tabText = (await page.locator('.panel .body').textContent()) ?? '';
    check('BTTV: во второй вкладке — разделы канала и глобальных', tabText.includes('Канал SomeChannel') && tabText.includes('Глобальные'), tabText.slice(0, 80));
    check('BTTV: модификаторы и код Owl Smile во вкладке не показаны', (await page.locator('.panel button[title="c!"], .panel button[title="CatJam"]').count()) === 0);
    check('BTTV: кнопки «+» на вкладке BetterTTV нет', await page.locator('.panel .add').isHidden());
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'twitch-picker-bttv.png') });
    await page.locator('.panel input').fill('chan');
    check('BTTV: поиск по вкладке', (await page.locator('.panel .grid button').count()) === 1);
    await page.evaluate(() => (window as unknown as { __owlReset(): void }).__owlReset());
    await page.locator('.panel button[title="ChanEmote"]').click();
    check('BTTV: клик вставляет код', Boolean(await waitFor(async () => ((await model()) === 'ChanEmote ' ? 'ok' : null), 3000)), JSON.stringify(await model()));
    await page.click('#owl-picker-btn');
    check('BTTV: окно открывается на последней вкладке, «Недавние» свои', (await page.locator('.tabs button[data-tab="bttv"][aria-selected="true"]').count()) === 1 && Boolean(await page.$('.panel >> text=Недавние')));
    await page.locator('.tabs button[data-tab="owl"]').click();
    check('BTTV: на вкладке Owl Smile смайлов BetterTTV нет', (await page.locator('.panel button[title="Glob3"]').count()) === 0 && (await page.locator('.panel button[title="CatJam"]').count()) > 0);
    await page.keyboard.press('Escape');

    // 4d. BetterTTV на VK Live: канал из окна расширения
    await vk.click('#owl-picker-btn');
    await vk.locator('.tabs button[data-tab="bttv"]').click();
    check('VK, BTTV: без канала — подсказка, глобальные есть', Boolean(await vk.$('.panel >> text=канал не указан')) && (await vk.locator('.panel button[title="Glob0"]').count()) === 1);
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.fill('#bttv-channel', 'нет такого');
    await popup.click('.bttv button');
    check('окно расширения: неверный канал отклонён', Boolean(await waitFor(() => popup.$('.bttv >> text=не похоже на Twitch-канал'))));
    await popup.fill('#bttv-channel', 'https://www.twitch.tv/VkChan');
    await popup.click('.bttv button');
    check('окно расширения: канал сохранён', Boolean(await waitFor(() => popup.$('.bttv >> text=Канал VkChan: 1 смайл'))), (await popup.textContent('.bttv')) ?? '');
    if (process.env.SHOTS) await popup.screenshot({ path: path.join(process.env.SHOTS, 'popup-bttv.png') });
    await popup.close();
    check('VK, BTTV: открытое окно смайлов само показало канал', Boolean(await waitFor(() => vk.$('.panel >> text=Канал VkChan'))));
    await vk.locator('.panel button[title="VkChanEmote"]').click();
    check('VK, BTTV: клик вставляет код', Boolean(await waitFor(async () => ((await vkText()) === 'VkChanEmote ' ? 'ok' : null), 3000)), JSON.stringify(await vkText()));
    await setReply('', 'end');
    await vk.evaluate(() => {
      const tpl = document.querySelector('[data-message-id="2"]')!.cloneNode(true) as HTMLElement;
      tpl.querySelector('[data-role="markup"]')!.textContent = 'VkChanEmote Glob1 ChanEmote';
      tpl.dataset.messageId = '3';
      delete tpl.dataset.owl;
      document.getElementById('chat')!.append(tpl);
    });
    const vkBttv = await waitFor(async () => {
      const alts = await vk.$$eval('[data-message-id="3"] img.owl-emote', (els) => els.map((e) => e.getAttribute('alt')));
      return alts.length ? alts : null;
    });
    check('VK, BTTV: смайлы канала из настроек и глобальные в чате; чужой канал — нет', JSON.stringify(vkBttv) === '["VkChanEmote","Glob1"]', JSON.stringify(vkBttv));
    await vk.click('#owl-picker-btn');
    await vk.locator('.tabs button[data-tab="owl"]').click();
    await vk.keyboard.press('Escape');

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

    // 6c. Профиль через страницу загрузки: подложка и поля одной записью, незнакомое поле сохраняется
    await manage.click('nav button:has-text("Зрители")');
    await manage.locator('.list-row', { hasText: 'owl_viewer' }).locator('button:has-text("Изменить")').click();
    await manage.fill('.profile-fields textarea', 'Обновлённое «о себе»');
    await manage.click('button:has-text("Сохранить")');
    await waitFor(async () => (await manage.textContent('.status'))?.startsWith('Готово') ?? false, 30000);
    const savedProfile = JSON.parse(server.show('profiles/twitch/owl_viewer.json').toString());
    check('профиль сохранён через страницу загрузки', savedProfile.about === 'Обновлённое «о себе»' && savedProfile.nameplate === 'stars' && savedProfile.future === 'поле будущей версии',
      JSON.stringify({ about: savedProfile.about, nameplate: savedProfile.nameplate, future: savedProfile.future }));
    if (process.env.SHOTS) await manage.screenshot({ path: path.join(process.env.SHOTS, 'manage-profile.png'), fullPage: true });
    await manage.click('nav button:has-text("Смайлы")');

    // 6d. Конструктор подложек: узор с шахматкой, потом «Изменить» → рамка
    await manage.click('nav button:has-text("Подложки")');
    await manage.click('.pattern-tile[title="Волны"]');
    await manage.check('.alt-layer input[type=checkbox]');
    await manage.click('.alt-layer button:has-text("Шахматка")');
    await manage.fill('input[placeholder="neon-bolts"]', 'neon-waves');
    await manage.fill('input[placeholder="Неоновые молнии"]', 'Неоновые волны');
    if (process.env.SHOTS) await manage.screenshot({ path: path.join(process.env.SHOTS, 'manage-nameplates.png'), fullPage: true });
    await manage.click('button:has-text("Создать подложку")');
    await waitFor(async () => (await manage.textContent('.status'))?.includes('Добавлена подложка neon-waves') && !(await manage.textContent('.status'))!.endsWith('…'), 30000);
    const created = JSON.parse(server.show('nameplates/neon-waves.json').toString());
    check('конструктор: подложка-узор с шахматкой', created.kind === 'pattern' && created.pattern === 'waves' && created.alt?.checker === true, JSON.stringify(created));
    await manage.locator('.list-row', { hasText: 'neon-waves' }).locator('button:has-text("Изменить")').click();
    await manage.click('.plate-editor button:has-text("Рамка")');
    await manage.click('button:has-text("Сохранить изменения")');
    await waitFor(async () => (await manage.textContent('.status'))?.includes('Изменена подложка neon-waves') && !(await manage.textContent('.status'))!.endsWith('…'), 30000);
    check('конструктор: «Изменить» перезаписывает', JSON.parse(server.show('nameplates/neon-waves.json').toString()).shape === 'frame');
    await manage.click('nav button:has-text("Смайлы")');

    // 7. Отказ от не-картинки
    await manage.setInputFiles('.drop input[type=file]', { name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('MZ\x90\x00not an image') });
    check('не-картинка отклонена', Boolean(await waitFor(() => manage.$('text=Это не картинка'))));
  } finally {
    await ctx.close();
    await server.close();
    await bttvServer.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log(failures ? `\nПровалено проверок: ${failures}` : '\nВсе проверки пройдены');
  process.exitCode = failures ? 1 : 0;
}

void main();
