import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { classifyMessage } from '../src/core/filters';
import { emojiTile, plateView } from '../src/core/paint';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  resetSettings,
  saveSettings,
  settingsFromStore,
  type Settings,
} from '../src/shared/settings';

describe('normalizeSettings', () => {
  it('мусор и пустота → значения по умолчанию', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('abc')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ enabled: 'yes', emoteSize: 'big', animation: 'sometimes', platforms: null })).toEqual(DEFAULT_SETTINGS);
  });

  it('числа зажимаются в границы, лишние поля отбрасываются', () => {
    const s = normalizeSettings({ emoteSize: 1000, badgeSize: -5, lineSpacing: 1.234, recentCount: 7.6, evil: '<script>' });
    expect(s.emoteSize).toBe(64);
    expect(s.badgeSize).toBe(12);
    expect(s.lineSpacing).toBe(1.2);
    expect(s.recentCount).toBe(8);
    expect('evil' in s).toBe(false);
  });

  it('частичные вложенные объекты дополняются', () => {
    const s = normalizeSettings({ platforms: { vk: false }, myNicks: { twitch: '  @Owl_Viewer ' } });
    expect(s.platforms).toEqual({ twitch: true, vk: false });
    expect(s.myNicks).toEqual({ twitch: 'owl_viewer', vk: '' });
  });

  it('списки: без пустых и повторов, ники — в нижнем регистре и без @', () => {
    const s = normalizeSettings({ hideWords: ['  Спойлер ', '', 'спойлер', 'Спойлер', 5], hideUsers: ['@Spammer', 'spammer', 'Данил  Кузнецов:'] });
    expect(s.hideWords).toEqual(['Спойлер', 'спойлер']);
    expect(s.hideUsers).toEqual(['spammer', 'данил кузнецов']);
  });

  it('цвет — только #RRGGBB', () => {
    expect(normalizeSettings({ highlightColor: 'red;background:url(x)' }).highlightColor).toBe(DEFAULT_SETTINGS.highlightColor);
    expect(normalizeSettings({ highlightColor: '#00ff00' }).highlightColor).toBe('#00ff00');
  });
});

describe('хранение настроек', () => {
  beforeEach(() => fakeBrowser.reset());

  it('сохраняет только изменённые поля, значения по умолчанию удаляет', async () => {
    await saveSettings({ emoteSize: 40, hideWords: ['спойлер'] });
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({ 'owl:p:emoteSize': 40, 'owl:p:hideWords': ['спойлер'] });
    expect((await loadSettings()).emoteSize).toBe(40);

    await saveSettings({ emoteSize: DEFAULT_SETTINGS.emoteSize });
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({ 'owl:p:hideWords': ['спойлер'] });

    await resetSettings();
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('settingsFromStore игнорирует чужие ключи', () => {
    expect(settingsFromStore({ 'owl:p:enabled': false, enabled: true, 'other:key': 1 }).enabled).toBe(false);
  });
});

describe('classifyMessage', () => {
  const s = (patch: Partial<Settings>) => normalizeSettings({ ...DEFAULT_SETTINGS, ...patch });

  it('скрывает по нику, боту и слову', () => {
    expect(classifyMessage('привет', 'spammer', s({ hideUsers: ['spammer'] }), 'twitch')).toMatchObject({ hide: true, reason: 'user' });
    expect(classifyMessage('!discord', 'nightbot', s({ hideBots: true }), 'twitch')).toMatchObject({ hide: true, reason: 'bot' });
    expect(classifyMessage('!discord', 'nightbot', s({ hideBots: false }), 'twitch').hide).toBe(false);
    expect(classifyMessage('кто Спойлер?', 'a', s({ hideWords: ['спойлер'] }), 'twitch')).toMatchObject({ hide: true, reason: 'word' });
  });

  it('одно слово — целиком, фраза — подстрокой', () => {
    const st = s({ hideWords: ['ass', 'кто выиграл'] });
    expect(classifyMessage('first class', 'a', st, 'twitch').hide).toBe(false);
    expect(classifyMessage('ну и кто выиграл в итоге', 'a', st, 'twitch').hide).toBe(true);
  });

  it('подсвечивает упоминания своего ника, но не свои сообщения', () => {
    const st = s({ myNicks: { twitch: 'owl_viewer', vk: 'данил кузнецов' } });
    expect(classifyMessage('@Owl_Viewer привет', 'anna', st, 'twitch').highlight).toBe(true);
    expect(classifyMessage('owl_viewerX привет', 'anna', st, 'twitch').highlight).toBe(false);
    expect(classifyMessage('@owl_viewer это я', 'owl_viewer', st, 'twitch').highlight).toBe(false);
    expect(classifyMessage('Данил Кузнецов, привет', 'anna', st, 'vk').highlight).toBe(true);
    expect(classifyMessage('@owl_viewer', 'anna', s({ ...st, highlightMentions: false }), 'twitch').highlight).toBe(false);
  });

  it('подсвечивает слова и зрителей; скрытие важнее подсветки', () => {
    const st = s({ highlightWords: ['розыгрыш'], highlightUsers: ['mod'], hideUsers: ['troll'] });
    expect(classifyMessage('Розыгрыш!', 'a', st, 'twitch').highlight).toBe(true);
    expect(classifyMessage('hi', 'mod', st, 'twitch').highlight).toBe(true);
    expect(classifyMessage('розыгрыш', 'troll', st, 'twitch')).toMatchObject({ hide: true, highlight: false });
  });
});

describe('plateView', () => {
  it('картинка — только data:image base64, эмодзи — только проверенные', () => {
    expect(plateView({ title: 't', kind: 'image' }, 'data:image/webp;base64,AAAA')?.bg).toBe('url("data:image/webp;base64,AAAA")');
    expect(plateView({ title: 't', kind: 'image' }, 'data:image/webp;base64,AA"); background: red')).toBeNull();
    expect(plateView({ title: 't', kind: 'image' }, 'https://evil.example/x.png')).toBeNull();
    expect(plateView({ title: 't', kind: 'emoji', emoji: '</text><script>' }, undefined)).toBeNull();
    const v = plateView({ title: 't', kind: 'emoji', emoji: '🦉✨', opacity: 5 }, undefined)!;
    expect(v.opacity).toBe(1);
    // Внутри url("…") — ни кавычек, ни скобок, ни не-ASCII: из CSS-значения не выбраться
    expect(v.bg).toMatch(/^url\("data:image\/svg\+xml,[\x21\x23-\x26\x2a-\x7e]+"\)$/);
  });

  it('узор из эмодзи — SVG без кавычек и скобок внутри url()', () => {
    const url = emojiTile('🦉✨');
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    expect(url.slice(19)).not.toMatch(/["'()<>\s]/);
    expect(decodeURIComponent(url.slice(19))).toContain('width="48"');
  });
});
