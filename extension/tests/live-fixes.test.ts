// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ChatLog } from '../src/core/chat-log';
import { applyNameplate, clearNameplate, patternTile, plateView } from '../src/core/paint';
import { ChatRenderer, emptyData } from '../src/core/renderer';
import { socialMark } from '../src/core/socials';
import { installTwitchCards } from '../src/core/twitch-card';
import type { Snapshot } from '../src/git/repo';
import { saveNameplate, setProfileInfo } from '../src/manage/ops';
import { twitchAdapter } from '../src/platforms/twitch';
import { NameplateSchema, ProfileSchema, isValidPlateSymbols, isBirthdayToday } from '../src/shared/schema';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings';

const dec = (b: Uint8Array | null | undefined) => (b ? JSON.parse(new TextDecoder().decode(b)) : b);
const URL_SAFE = /^url\("data:image\/svg\+xml,[\x21\x23-\x26\x2a-\x7e]+"\)/;

describe('новые поля профиля', () => {
  it('день рождения, часовой пояс, языки, интересы, статус', () => {
    const ok = { status: 'Играю', birthday: '02-29', timezone: 'Europe/Moscow', languages: ['ru', 'en'], interests: ['аниме', 'CS2'] };
    expect(ProfileSchema.safeParse(ok).success).toBe(true);
    expect(ProfileSchema.safeParse({ birthday: '02-30' }).success).toBe(false);
    expect(ProfileSchema.safeParse({ birthday: '13-01' }).success).toBe(false);
    expect(ProfileSchema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(ProfileSchema.safeParse({ timezone: '"><x' }).success).toBe(false);
    expect(ProfileSchema.safeParse({ languages: ['xx'] }).success).toBe(false);
    expect(ProfileSchema.safeParse({ interests: ['1', '2', '3', '4', '5', '6'] }).success).toBe(false);
    expect(ProfileSchema.safeParse({ status: 'x'.repeat(61) }).success).toBe(false);
  });

  it('день рождения сегодня', () => {
    expect(isBirthdayToday('11-14', new Date(2026, 10, 14))).toBe(true);
    expect(isBirthdayToday('11-15', new Date(2026, 10, 14))).toBe(false);
    expect(isBirthdayToday(undefined)).toBe(false);
  });

  const snap = (): Snapshot => ({
    head: 'h', emotes: {}, badges: {}, badgeInfo: {}, paints: {}, users: {}, nameplates: {}, profiles: {}, images: {}, problems: [],
  });

  it('since ставится только новому профилю; профиль из одних дат удаляется', () => {
    const ch = setProfileInfo('twitch', 'newbie', { status: 'привет', interests: [' аниме ', 'аниме', ''], languages: ['ru', 'ru'] })(snap());
    const p = dec(ch.get('profiles/twitch/newbie.json'));
    expect(p).toMatchObject({ status: 'привет', interests: ['аниме'], languages: ['ru'] });
    expect(p.since).toBeTruthy();
    const s = snap();
    s.profiles['twitch:old'] = { status: 'x', since: '2026-01-01T00:00:00.000Z' };
    expect(setProfileInfo('twitch', 'old', {})(s).get('profiles/twitch/old.json')).toBeNull();
  });
});

describe('подложки: узоры и символы', () => {
  it('символы — белый список', () => {
    for (const ok of ['////', '::::', '\\\\', '⚡ ⚡', '~≈~', '░▒▓']) expect(isValidPlateSymbols(ok), ok).toBe(true);
    for (const bad of ['<b>', '"x"', "a'b", 'a&b', '🦉', '', '   ', 'x'.repeat(9), '`']) expect(isValidPlateSymbols(bad), bad).toBe(false);
  });

  it('схема: узор и символы требуют цвет; виды не смешиваются; второй слой', () => {
    const base = { id: 'bolts', title: 'Молнии', author: 'me' };
    expect(NameplateSchema.safeParse({ ...base, kind: 'pattern', pattern: 'lightning', colors: ['#ff00ff'] }).success).toBe(true);
    expect(NameplateSchema.safeParse({ ...base, kind: 'pattern', pattern: 'lightning' }).success).toBe(false);
    expect(NameplateSchema.safeParse({ ...base, kind: 'pattern', pattern: 'nope', colors: ['#ff00ff'] }).success).toBe(false);
    expect(NameplateSchema.safeParse({ ...base, kind: 'pattern', pattern: 'slash', emoji: '🦉', colors: ['#ff00ff'] }).success).toBe(false);
    expect(NameplateSchema.safeParse({ ...base, kind: 'symbols', symbols: '<x>', colors: ['#ff00ff'] }).success).toBe(false);
    expect(NameplateSchema.safeParse({ ...base, kind: 'symbols', symbols: '//', colors: ['red'] }).success).toBe(false);
    expect(
      NameplateSchema.safeParse({ ...base, kind: 'pattern', pattern: 'slash', colors: ['#ff00ff'], alt: { color: '#00ffff', pattern: 'dots', checker: true } }).success,
    ).toBe(true);
    expect(NameplateSchema.safeParse({ ...base, kind: 'pattern', pattern: 'slash', colors: ['#ff00ff'], alt: { color: 'url(x)' } }).success).toBe(false);
  });

  it('плитки: безопасные url, второй слой «1-2-1-2» и шахматка', () => {
    const one = patternTile({ pattern: 'slash' }, '#ff00ff');
    expect(one).toMatchObject({ w: 12, h: 24 });
    const line = patternTile({ pattern: 'slash' }, '#ff00ff', { color: '#00ffff', pattern: 'dots' });
    expect(line).toMatchObject({ w: 20, h: 24 });
    const svg = decodeURIComponent(line.url.slice('data:image/svg+xml,'.length));
    expect(svg).toContain('#ff00ff');
    expect(svg).toContain('#00ffff');
    expect(patternTile({ pattern: 'slash' }, '#ff00ff', { color: '#00ffff', checker: true })).toMatchObject({ w: 24, h: 24 });
    // Символы: цвета через один
    const sym = decodeURIComponent(patternTile({ symbols: '//' }, '#111111', { color: '#222222' }).url.split(',')[1]!);
    expect(sym.indexOf('#111111')).toBeLessThan(sym.indexOf('#222222'));
    for (const v of [
      plateView({ title: 't', kind: 'pattern', pattern: 'waves', colors: ['#ff00ff', '#000000'], glow: 1, alt: { color: '#00ffff', checker: true } }, undefined)!,
      plateView({ title: 't', kind: 'symbols', symbols: '⚡/', colors: ['#ff00ff'] }, undefined)!,
    ]) {
      expect(v.bg).toMatch(URL_SAFE);
    }
  });

  it('вид подложки: границы чисел, классы формы и анимации', () => {
    const v = plateView({ title: 't', kind: 'pattern', pattern: 'zigzag', colors: ['#ff00ff'], glow: 5, speed: 100, shape: 'frame', anim: 'shimmer', fade: true }, undefined)!;
    expect(v.pattern).toMatchObject({ glow: 8, speed: 20, shape: 'frame', anim: 'shimmer', fade: true });
    expect(plateView({ title: 't', kind: 'pattern', pattern: 'zigzag', colors: ['nope'] }, undefined)).toBeNull();
    const span = document.createElement('span');
    const wrap = document.createElement('span');
    wrap.append(span);
    applyNameplate(span, v);
    expect([...span.classList]).toEqual(expect.arrayContaining(['owl-plate', 'owl-plate--pattern', 'owl-plate--frame', 'owl-plate--anim-shimmer', 'owl-plate--fade']));
    clearNameplate(span);
    expect(span.className).toBe('');
    expect(span.getAttribute('style') ?? '').toBe('');
  });

  it('saveNameplate: создать, изменить только узорную, старые виды не менять', () => {
    const s: Snapshot = {
      head: 'h', emotes: {}, badges: {}, badgeInfo: {}, paints: {}, users: {}, profiles: {}, images: {}, problems: [],
      nameplates: { old: { id: 'old', title: 'O', kind: 'emoji', emoji: '⭐', author: 'x' }, bolts: { id: 'bolts', title: 'B', kind: 'pattern', pattern: 'lightning', colors: ['#ffffff'], author: 'x' } },
    };
    const input = { id: 'bolts', title: 'Молнии', kind: 'pattern' as const, pattern: 'lightning' as const, colors: ['#ff00ff'], opacity: 0.8, glow: 0.5, anim: 'none' as const, shape: 'fill' as const };
    expect(() => saveNameplate(input, 'me')(s)).toThrow('уже есть');
    const p = dec(saveNameplate({ ...input, shape: 'underline', alt: { color: '#00ffff', pattern: 'lightning', checker: false } }, 'me', true)(s).get('nameplates/bolts.json'));
    // Значения по умолчанию не пишутся; второй слой без лишнего узора (тот же)
    expect(p).toEqual({ id: 'bolts', title: 'Молнии', kind: 'pattern', pattern: 'lightning', colors: ['#ff00ff'], opacity: 0.8, glow: 0.5, shape: 'underline', alt: { color: '#00ffff' }, author: 'me' });
    expect(() => saveNameplate({ ...input, id: 'old' }, 'me', true)(s)).toThrow('только узоры');
    expect(() => saveNameplate({ ...input, id: 'sym', kind: 'symbols', symbols: '<>' }, 'me')).toThrow('Символы');
  });
});

describe('журнал чата и соцсети', () => {
  it('ChatLog: счёт, последние 5, вытеснение', () => {
    const log = new ChatLog();
    for (let i = 1; i <= 7; i++) log.add('twitch:a', `сообщение ${i}`, i);
    expect(log.get('twitch:a').count).toBe(7);
    expect(log.get('twitch:a').last.map((m) => m.text)).toEqual(['сообщение 3', 'сообщение 4', 'сообщение 5', 'сообщение 6', 'сообщение 7']);
    expect(log.get('twitch:nobody')).toEqual({ count: 0, last: [] });
    for (let i = 0; i < 510; i++) log.add(`twitch:u${i}`, 'x');
    expect(log.get('twitch:a').count).toBe(0); // самый давний вытеснен
  });

  it('socialMark', () => {
    expect(socialMark('https://t.me/owl')?.label).toBe('TG');
    expect(socialMark('https://www.youtube.com/@owl')?.label).toBe('YT');
    expect(socialMark('https://m.vk.com/owl')?.label).toBe('VK');
    expect(socialMark('https://evil-t.me.example/')).toBeNull();
    expect(socialMark('https://example.com/')).toBeNull();
  });
});

describe('чат: 🎂 и журнал', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="chat">
      <div class="chat-line__message" data-a-user="owl"><span class="chat-line__username"><span class="chat-author__display-name">owl</span></span>: <span class="text-fragment">hi</span></div>
    </div>`;
  });

  it('в день рождения — 🎂 у ника; сообщения попадают в журнал один раз', () => {
    const d = emptyData();
    d.version = 'v';
    const now = new Date();
    d.profiles['twitch:owl'] = { birthday: `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` };
    const log = new ChatLog();
    const r = new ChatRenderer(twitchAdapter, d, DEFAULT_SETTINGS, log);
    r.processTree(document);
    r.processMessage(document.querySelector('.chat-line__message')!, true);
    expect(document.querySelector('.owl-badges .owl-bday')?.textContent).toBe('🎂');
    expect(log.get('twitch:owl')).toMatchObject({ count: 1, last: [{ text: 'hi' }] });
  });
});

describe('блок Owl в карточке Twitch', () => {
  beforeEach(() => fakeBrowser.reset());

  it('вставляется в карточку Twitch под шапку; у неоформленного — компактная строка', async () => {
    document.body.innerHTML = `<div id="chat">
      <div class="chat-line__message" data-a-user="owl"><span class="chat-line__username"><span class="chat-author__display-name">Owl</span></span>: <span class="text-fragment">hi</span></div>
      <div class="chat-line__message" data-a-user="plain"><span class="chat-line__username"><span class="chat-author__display-name">plain</span></span>: <span class="text-fragment">yo</span></div>
    </div>`;
    // «Twitch»: по клику на ник показывает свою карточку (с задержкой, как настоящий)
    document.getElementById('chat')!.addEventListener('click', (e) => {
      const m = (e.target as Element).closest('[data-a-user]');
      if (!m) return;
      setTimeout(() => {
        document.querySelector('.viewer-card-layer')?.remove();
        const layer = document.createElement('div');
        layer.className = 'viewer-card-layer';
        layer.innerHTML = `<div class="viewer-card" data-a-target="viewer-card"><div class="viewer-card-header__banner"><div class="viewer-card-header__display-name">${m.getAttribute('data-a-user')}</div></div><div class="viewer-card__body">Значки</div></div>`;
        document.body.append(layer);
      }, 50);
    });
    const data = emptyData();
    data.profiles['twitch:owl'] = { status: 'Играю в соулсы', about: 'Совиный модератор' };
    const log = new ChatLog();
    log.add('twitch:owl', 'hi', Date.now());
    const dispose = installTwitchCards(twitchAdapter, () => data, () => normalizeSettings(DEFAULT_SETTINGS), log);

    document.querySelector<HTMLElement>('[data-a-user="owl"] .chat-author__display-name')!.click();
    await new Promise((r) => setTimeout(r, 400));
    const card = document.querySelector('.viewer-card')!;
    const host = card.querySelector('.owl-vc-host')!;
    expect(host).not.toBeNull();
    // Сразу после шапки, карточка Twitch на месте
    expect(host.previousElementSibling?.className).toBe('viewer-card-header__banner');
    expect(card.querySelector('.viewer-card__body')?.textContent).toBe('Значки');
    const text = host.shadowRoot!.textContent!;
    expect(text).toContain('Пользователь Owl Smile');
    expect(text).toContain('Играю в соулсы');
    expect(text).toContain('Совиный модератор');
    expect(text).toContain('Сообщений в этом чате: 1');

    document.querySelector<HTMLElement>('[data-a-user="plain"] .chat-author__display-name')!.click();
    await new Promise((r) => setTimeout(r, 400));
    const plainHost = document.querySelector('.viewer-card .owl-vc-host')!;
    expect(plainHost.shadowRoot!.textContent).toContain('Owl Smile · сообщений в этом чате: 0');
    expect(plainHost.shadowRoot!.textContent).not.toContain('Пользователь Owl Smile');
    dispose();
    expect(document.querySelector('.owl-vc-host')).toBeNull();
  });
});
