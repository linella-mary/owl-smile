// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { loadRenderData } from '../src/core/start';
import { ChatRenderer } from '../src/core/renderer';
import { twitchAdapter } from '../src/platforms/twitch';
import {
  BTTV_TTL_MS,
  K_BTTV_CHANNELS,
  K_BTTV_GLOBAL,
  K_BTTV_SETTING,
  MAX_CHANNELS,
  bttvChannelKey,
  createBttvSync,
  normalizeLogin,
  parseChannel,
  parseEmotes,
  parseIvrUser,
  twitchChannelFromUrl,
  type BttvChannel,
} from '../src/shared/bttv';

const id = (n: number) => n.toString(16).padStart(24, '0');

describe('разбор ответов BetterTTV', () => {
  it('пропускает модификаторы, кривые записи и повторы кода', () => {
    const list = parseEmotes([
      { id: id(1), code: 'KKona', imageType: 'png', animated: false, width: 25, height: 34 },
      { id: id(2), code: 'c!', modifier: true },
      { id: 'плохой', code: 'Bad' },
      { id: id(3), code: 'с пробелом' },
      { id: id(4), code: 'KKona' },
      { id: id(5), code: 'SourPls', animated: true },
      null,
      'мусор',
    ]);
    expect(list).toEqual([
      { id: id(1), code: 'KKona', animated: false, w: 25, h: 34 },
      { id: id(5), code: 'SourPls', animated: true },
    ]);
    expect(parseEmotes({ not: 'array' })).toEqual([]);
  });

  it('канал: свои смайлы раньше общих', () => {
    const list = parseChannel({
      id: 'x',
      channelEmotes: [{ id: id(1), code: 'Own' }],
      sharedEmotes: [{ id: id(2), code: 'Shared', user: { name: 'someone' } }, { id: id(3), code: 'Own' }],
    });
    expect(list.map((e) => e.code)).toEqual(['Own', 'Shared']);
    expect(list[0]!.id).toBe(id(1));
  });

  it('id канала по ответу ivr.fi', () => {
    expect(parseIvrUser([{ login: 'forsen', id: '22484632', displayName: 'forsen' }], 'forsen')).toEqual({ id: '22484632', name: 'forsen' });
    expect(parseIvrUser([{ login: 'other', id: '1' }], 'forsen')).toBeNull();
    expect(parseIvrUser([], 'forsen')).toBeNull();
    expect(parseIvrUser({ error: 'x' }, 'forsen')).toBeNull();
  });

  it('логин из того, что ввёл человек', () => {
    expect(normalizeLogin('Forsen')).toBe('forsen');
    expect(normalizeLogin(' @forsen ')).toBe('forsen');
    expect(normalizeLogin('https://www.twitch.tv/forsen/videos')).toBe('forsen');
    expect(normalizeLogin('twitch.tv/popout/forsen/chat')).toBe('forsen');
    expect(normalizeLogin('не канал')).toBeNull();
    expect(normalizeLogin('')).toBeNull();
  });

  it('канал по адресу страницы Twitch', () => {
    expect(twitchChannelFromUrl('https://www.twitch.tv/forsen')).toBe('forsen');
    expect(twitchChannelFromUrl('https://www.twitch.tv/Forsen/videos?filter=all')).toBe('forsen');
    expect(twitchChannelFromUrl('https://www.twitch.tv/popout/forsen/chat?popout=')).toBe('forsen');
    expect(twitchChannelFromUrl('https://www.twitch.tv/moderator/forsen')).toBe('forsen');
    expect(twitchChannelFromUrl('https://dashboard.twitch.tv/u/forsen/stream-manager')).toBe('forsen');
    expect(twitchChannelFromUrl('https://www.twitch.tv/directory/category/just-chatting')).toBeNull();
    expect(twitchChannelFromUrl('https://www.twitch.tv/videos/123456')).toBeNull();
    expect(twitchChannelFromUrl('https://www.twitch.tv/')).toBeNull();
    expect(twitchChannelFromUrl('https://live.vkvideo.ru/forsen')).toBeNull();
  });
});

// ── Обновление списков ──

function rig(routes: Record<string, () => { status: number; body?: unknown }>) {
  const db: Record<string, unknown> = {};
  const calls: string[] = [];
  let t = 1_000_000;
  const store = {
    get: async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in db).map((k) => [k, structuredClone(db[k])])),
    set: async (items: Record<string, unknown>) => void Object.assign(db, structuredClone(items)),
    remove: async (keys: string[]) => keys.forEach((k) => delete db[k]),
  };
  const fetchFn = (async (url: string) => {
    calls.push(url);
    const route = Object.entries(routes).find(([k]) => url.includes(k));
    if (!route) throw new TypeError('Failed to fetch');
    const { status, body } = route[1]();
    return new Response(JSON.stringify(body ?? {}), { status });
  }) as unknown as typeof fetch;
  const sync = createBttvSync({ store, fetch: fetchFn, now: () => t });
  return { sync, db, calls, tick: (ms: number) => (t += ms) };
}

const ok = (body: unknown) => () => ({ status: 200, body });

describe('обновление списков BetterTTV', () => {
  it('глобальные: качаются раз в 15 минут, при сбое остаётся прошлый список', async () => {
    let fail = false;
    const r = rig({ '/3/cached/emotes/global': () => (fail ? { status: 503 } : { status: 200, body: [{ id: id(1), code: 'LuL' }] }) });
    await r.sync.refreshGlobal();
    await r.sync.refreshGlobal();
    expect(r.calls).toHaveLength(1);
    expect((r.db[K_BTTV_GLOBAL] as { emotes: unknown[] }).emotes).toHaveLength(1);

    r.tick(BTTV_TTL_MS + 1);
    fail = true;
    const g = await r.sync.refreshGlobal();
    expect(r.calls).toHaveLength(2);
    expect(g.emotes).toHaveLength(1);
    expect(g.error).toMatch(/503/);
  });

  it('канал: логин → id через ivr.fi один раз, потом только BetterTTV', async () => {
    const r = rig({
      'ivr.fi/v2/twitch/user?login=forsen': ok([{ login: 'forsen', id: '22484632', displayName: 'Forsen' }]),
      '/3/cached/users/twitch/22484632': ok({ channelEmotes: [{ id: id(1), code: 'forsenE' }], sharedEmotes: [] }),
    });
    const ch = await r.sync.refreshChannel('Forsen');
    expect(ch).toMatchObject({ login: 'forsen', name: 'Forsen', id: '22484632', emotes: [{ code: 'forsenE' }] });
    expect(r.db[K_BTTV_CHANNELS]).toEqual(['forsen']);

    await r.sync.refreshChannel('forsen');
    expect(r.calls).toHaveLength(2); // свежий — сеть не трогаем
    r.tick(BTTV_TTL_MS + 1);
    await r.sync.refreshChannel('forsen');
    expect(r.calls.filter((u) => u.includes('ivr.fi'))).toHaveLength(1);
    expect(r.calls.filter((u) => u.includes('betterttv'))).toHaveLength(2);
  });

  it('канал без BetterTTV (404) — не ошибка; несуществующий канал — понятная ошибка', async () => {
    const r = rig({
      'login=quiet': ok([{ login: 'quiet', id: '42', displayName: 'Quiet' }]),
      '/users/twitch/42': () => ({ status: 404, body: { message: 'user not found' } }),
      'login=nobody': ok([]),
    });
    const quiet = await r.sync.refreshChannel('quiet');
    expect(quiet).toMatchObject({ missing: true, emotes: [] });
    expect(quiet!.error).toBeUndefined();
    const nobody = await r.sync.refreshChannel('nobody');
    expect(nobody!.error).toBe('такого канала на Twitch нет');
  });

  it('сбой сети не стирает уже загруженные смайлы канала', async () => {
    let down = false;
    const r = rig({
      'login=forsen': ok([{ login: 'forsen', id: '1', displayName: 'forsen' }]),
      '/users/twitch/1': () => (down ? { status: 500 } : { status: 200, body: { channelEmotes: [{ id: id(1), code: 'forsenE' }] } }),
    });
    await r.sync.refreshChannel('forsen');
    r.tick(BTTV_TTL_MS + 1);
    down = true;
    const ch = await r.sync.refreshChannel('forsen');
    expect(ch!.emotes).toHaveLength(1);
    expect(ch!.error).toMatch(/500/);
  });

  it('хранится не больше MAX_CHANNELS каналов, канал из настроек не удаляется', async () => {
    const routes: Record<string, () => { status: number; body?: unknown }> = {};
    for (let i = 0; i <= MAX_CHANNELS + 1; i++) {
      routes[`login=ch${i}&`] = ok([{ login: `ch${i}`, id: String(100 + i) }]);
      routes[`login=ch${i}`] = ok([{ login: `ch${i}`, id: String(100 + i) }]);
      routes[`/users/twitch/${100 + i}`] = ok({ channelEmotes: [] });
    }
    const r = rig(routes);
    await r.sync.setSettingChannel('ch0');
    for (let i = 1; i <= MAX_CHANNELS + 1; i++) await r.sync.refreshChannel(`ch${i}`);
    const list = r.db[K_BTTV_CHANNELS] as string[];
    expect(list).toHaveLength(MAX_CHANNELS);
    expect(list).toContain('ch0');
    expect(r.db[bttvChannelKey('ch0')]).toBeTruthy();
    expect(r.db[bttvChannelKey('ch1')]).toBeUndefined();
  });

  it('настройка канала: проверка ввода и очистка', async () => {
    const r = rig({ 'login=forsen': ok([{ login: 'forsen', id: '1' }]), '/users/twitch/1': ok({ channelEmotes: [] }) });
    expect(await r.sync.setSettingChannel('не канал')).toMatchObject({ ok: false });
    expect(r.db[K_BTTV_SETTING]).toBeUndefined();
    expect(await r.sync.setSettingChannel('https://twitch.tv/Forsen')).toEqual({ ok: true, login: 'forsen' });
    expect(r.db[K_BTTV_SETTING]).toBe('forsen');
    expect(await r.sync.setSettingChannel('  ')).toEqual({ ok: true, login: null });
    expect(r.db[K_BTTV_SETTING]).toBeUndefined();
  });
});

// ── Вкладка: данные для чата и окна смайлов ──

describe('смайлы BetterTTV во вкладке чата', () => {
  beforeEach(() => fakeBrowser.reset());

  const channel = (over: Partial<BttvChannel>): BttvChannel => ({
    login: 'forsen', name: 'forsen', id: '1', at: 5, usedAt: 5, emotes: [], ...over,
  });

  it('Owl Smile важнее канала, канал важнее глобальных', async () => {
    await fakeBrowser.storage.local.set({
      'owl:index': { head: 'h1', syncedAt: 1, emotes: { CatJam: { img: 'o1', animated: false, w: 28, h: 28, author: 'a' } }, badges: {}, paints: {}, users: {} },
      'img:o1': 'data:image/webp;base64,AA==',
      [K_BTTV_GLOBAL]: { at: 7, emotes: [{ id: id(1), code: 'LuL', animated: false }, { id: id(2), code: 'CatJam', animated: false }, { id: id(3), code: 'Same', animated: false }] },
      [bttvChannelKey('forsen')]: channel({ emotes: [{ id: id(4), code: 'Same', animated: true }, { id: id(5), code: 'forsenE', animated: false }] }),
    });
    const d = await loadRenderData('forsen');
    expect(d.emotes.get('CatJam')!.bttv).toBeUndefined();
    expect(d.emotes.get('Same')!.src).toContain(id(4));
    expect(d.emotes.get('LuL')).toMatchObject({ bttv: true, src: `https://cdn.betterttv.net/emote/${id(1)}/1x.webp` });
    expect(d.emotes.get('LuL')!.srcset).toContain('2x.webp 2x');
    expect(d.bttv.channel).toMatchObject({ name: 'forsen', state: 'ok', codes: ['Same', 'forsenE'] });
    expect(d.bttv.global).toEqual(['LuL']); // CatJam — у Owl Smile, Same — у канала
    expect(d.version).toBe('h1|7|forsen|5');
  });

  it('состояния канала: грузится, нет на BetterTTV, ошибка; без канала — null', async () => {
    expect((await loadRenderData('forsen')).bttv.channel!.state).toBe('loading');
    await fakeBrowser.storage.local.set({ [bttvChannelKey('forsen')]: channel({ missing: true }) });
    expect((await loadRenderData('forsen')).bttv.channel!.state).toBe('missing');
    await fakeBrowser.storage.local.set({ [bttvChannelKey('forsen')]: channel({ at: 0, error: 'нет ответа' }) });
    expect((await loadRenderData('forsen')).bttv.channel).toMatchObject({ state: 'error', error: 'нет ответа' });
    expect((await loadRenderData(null)).bttv.channel).toBeNull();
  });

  it('в сообщении чата смайл BetterTTV — картинка с CDN и srcset', async () => {
    await fakeBrowser.storage.local.set({ [K_BTTV_GLOBAL]: { at: 1, emotes: [{ id: id(1), code: 'LuL', animated: false }] } });
    document.body.innerHTML = `<div class="chat-line__message" data-a-user="x"><span class="text-fragment" data-a-target="chat-message-text">ну LuL и всё</span></div>`;
    new ChatRenderer(twitchAdapter, await loadRenderData(null)).processTree(document);
    const img = document.querySelector<HTMLImageElement>('img.owl-emote')!;
    expect(img.alt).toBe('LuL');
    expect(img.getAttribute('src')).toBe(`https://cdn.betterttv.net/emote/${id(1)}/1x.webp`);
    expect(img.getAttribute('srcset')).toBe(`https://cdn.betterttv.net/emote/${id(1)}/1x.webp 1x, https://cdn.betterttv.net/emote/${id(1)}/2x.webp 2x`);
  });
});
