// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { installProfileCards } from '../src/core/profile-card';
import { emptyData, type RenderData } from '../src/core/renderer';
import type { Snapshot } from '../src/git/repo';
import { setNameplate, setProfile, setProfileInfo } from '../src/manage/ops';
import { twitchAdapter } from '../src/platforms/twitch';
import { ProfileSchema, isSafeUrl } from '../src/shared/schema';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../src/shared/settings';

const dec = (b: Uint8Array | null | undefined) => (b ? JSON.parse(new TextDecoder().decode(b)) : b);

describe('профиль: данные', () => {
  it('ссылки — только https без логина и пароля', () => {
    expect(isSafeUrl('https://t.me/owl')).toBe(true);
    expect(isSafeUrl('http://t.me/owl')).toBe(false);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,<b>')).toBe(false);
    expect(isSafeUrl('https://user:pass@evil.example/')).toBe(false);
    expect(isSafeUrl('https://example.com/' + 'a'.repeat(200))).toBe(false);
  });

  it('схема: проверяет известные поля, незнакомые сохраняет', () => {
    const ok = { about: 'строка\nвторая', pronouns: 'он', links: [{ title: 'TG', url: 'https://t.me/owl' }], favEmotes: ['CatJam'], alsoOn: { platform: 'vk', nick: 'данил' }, accent: '#123456', future: 1 };
    const r = ProfileSchema.safeParse(ok);
    expect(r.success && r.data).toMatchObject({ future: 1, about: 'строка\nвторая' });
    expect(ProfileSchema.safeParse({ links: [{ title: 'x', url: 'http://a.b/' }] }).success).toBe(false);
    expect(ProfileSchema.safeParse({ about: 'a'.repeat(301) }).success).toBe(false);
    expect(ProfileSchema.safeParse({ pronouns: 'он\u0000' }).success).toBe(false);
    expect(ProfileSchema.safeParse({ alsoOn: { platform: 'twitch', nick: 'не латиница' } }).success).toBe(false);
    expect(ProfileSchema.safeParse({ accent: 'red' }).success).toBe(false);
    // Новое поле внутри ссылки из будущей версии не ломает профиль
    expect(ProfileSchema.safeParse({ links: [{ title: 'x', url: 'https://a.b/', icon: 'tg' }] }).success).toBe(true);
  });

  const snap = (): Snapshot => ({
    head: 'h',
    emotes: { CatJam: { code: 'CatJam', image: 'img/aaaaaaaaaaaaaaaa.webp', animated: false, w: 28, h: 28, author: 'x', createdAt: '' } },
    badges: {},
    badgeInfo: {},
    paints: {},
    users: {},
    nameplates: { stars: { id: 'stars', title: 'S', kind: 'emoji', emoji: '⭐', author: 'x' } },
    profiles: { 'twitch:owl': { nameplate: 'stars', about: 'старое', future: { x: 1 } } },
    images: { 'img/aaaaaaaaaaaaaaaa.webp': 'oid' },
    problems: [],
  });

  it('setProfileInfo: заменяет поля профиля, подложку и незнакомое не трогает', () => {
    const ch = setProfileInfo('twitch', 'owl', {
      about: '  привет\r\n\r\n\r\n\r\nмир ', links: [{ title: '', url: 'https://www.t.me/owl' }, { title: 'пусто', url: '' }], favEmotes: ['CatJam', 'CatJam'],
    })(snap());
    const p = dec(ch.get('profiles/twitch/owl.json'));
    expect(p).toMatchObject({ nameplate: 'stars', future: { x: 1 }, about: 'привет\n\nмир', links: [{ title: 't.me', url: 'https://www.t.me/owl' }], favEmotes: ['CatJam'] });
    expect(p.updatedAt).toBeTruthy();
  });

  it('setProfileInfo: ошибки понятные, пустой профиль — поля убираются', () => {
    expect(() => setProfileInfo('twitch', 'owl', { links: [{ title: 'x', url: 'http://a.b/' }] })).toThrow('ссылки (только https://)');
    expect(() => setProfileInfo('twitch', 'owl', { alsoOn: { platform: 'twitch', nick: 'Owl' } })).toThrow('другая площадка');
    expect(() => setProfileInfo('twitch', 'owl', { favEmotes: ['Nope'] })(snap())).toThrow('нет в базе');
    const p = dec(setProfileInfo('twitch', 'owl', {})(snap()).get('profiles/twitch/owl.json'));
    expect(p).toEqual({ nameplate: 'stars', future: { x: 1 } });
  });

  it('те же данные — изменений нет (updatedAt не дёргается)', () => {
    const s = snap();
    expect(setProfileInfo('twitch', 'owl', { about: 'старое' })(s).size).toBe(0);
    expect(setNameplate('twitch', 'owl', 'stars')(s).size).toBe(0);
  });

  it('setProfile: подложка и поля одной записью (не затирают друг друга)', () => {
    const ch = setProfile('vk', 'Новый Ник', { nameplate: 'stars', info: { pronouns: 'она' } })(snap());
    expect(ch.size).toBe(1);
    expect(dec(ch.get('profiles/vk/новый ник.json'))).toMatchObject({ nameplate: 'stars', pronouns: 'она' });
    expect(setProfile('twitch', 'owl', { nameplate: undefined, info: {} })(snap()).get('profiles/twitch/owl.json')).toEqual(
      new TextEncoder().encode(JSON.stringify({ future: { x: 1 } }, null, 2) + '\n'),
    );
  });
});

const message = (login: string) => `
  <div class="chat-line__message" data-a-user="${login}">
    <span class="chat-line__username"><span class="chat-author__display-name">${login}</span></span>: <span class="text-fragment">hi</span>
  </div>`;

describe('карточка профиля в чате', () => {
  let settings: Settings;
  let data: RenderData;
  let dispose: () => void;
  let native: string[];

  beforeEach(() => {
    fakeBrowser.reset();
    settings = normalizeSettings(DEFAULT_SETTINGS);
    data = emptyData();
    data.badges.set('mod', { src: 'data:image/png;base64,AA==', title: 'Модератор', description: 'Следит за порядком' });
    data.users['twitch:owl'] = { badges: ['mod'] };
    data.profiles['twitch:owl'] = { about: 'Совиный модератор', links: [{ title: 'Канал', url: 'https://t.me/owl' }, { title: 'bad', url: 'javascript:alert(1)' }] };
    document.body.innerHTML = `<div id="chat">${message('owl')}${message('plain')}</div>`;
    native = [];
    // Обработчик площадки (как карточка зрителя Twitch)
    document.getElementById('chat')!.addEventListener('click', (e) => {
      const m = (e.target as Element).closest('[data-a-user]');
      if (m) native.push(m.getAttribute('data-a-user')!);
    });
    dispose = installProfileCards(twitchAdapter, () => data, () => settings);
  });
  afterEach(() => dispose());

  const name = (login: string) => document.querySelector<HTMLElement>(`[data-a-user="${login}"] .chat-author__display-name`)!;
  const card = () => document.querySelector('.owl-card-host')?.shadowRoot ?? null;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('у оформленного — наша карточка вместо карточки площадки', async () => {
    name('owl').click();
    await flush();
    expect(native).toEqual([]);
    expect(card()?.querySelector('.about')?.textContent).toBe('Совиный модератор');
    // Иконка с описанием
    expect(card()?.querySelector('.badge')?.textContent).toBe('МодераторСледит за порядком');
    // Опасная ссылка не показана
    const links = [...card()!.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['https://t.me/owl']);
  });

  it('у неоформленного, по Alt+клику и при выключенной настройке — карточка площадки', async () => {
    name('plain').click();
    name('owl').dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
    settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: false });
    name('owl').click();
    await flush();
    expect(native).toEqual(['plain', 'owl', 'owl']);
    expect(card()).toBeNull();
  });

  it('кнопка «Профиль Twitch» закрывает карточку и открывает карточку площадки', async () => {
    name('owl').click();
    await flush();
    const btn = [...card()!.querySelectorAll('button')].find((b) => b.textContent === 'Профиль Twitch')!;
    btn.click();
    expect(native).toEqual(['owl']);
    expect(card()).toBeNull();
    // Следующий обычный клик — снова наша карточка
    name('owl').click();
    await flush();
    expect(card()).not.toBeNull();
    expect(native).toEqual(['owl']);
  });

  it('заметка сохраняется только локально', async () => {
    name('owl').click();
    await flush();
    const ta = card()!.querySelector('textarea')!;
    ta.value = 'помогал с ботом';
    ta.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 450));
    expect((await fakeBrowser.storage.local.get('owl:notes'))['owl:notes']).toEqual({ 'twitch:owl': 'помогал с ботом' });
  });
});
