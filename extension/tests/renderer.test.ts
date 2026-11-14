// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { ChatRenderer, emoteCaption, emptyData, type RenderData } from '../src/core/renderer';
import { twitchAdapter } from '../src/platforms/twitch';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../src/shared/settings';

/** Упрощённая разметка сообщения Twitch (сверить с живой страницей на этапе 0.2). */
const message = (login: string, text: string) => `
  <div class="chat-line__message" data-a-user="${login}">
    <span class="chat-line__username-container">
      <span class="chat-badge"></span>
      <span class="chat-line__username"><span class="chat-author__display-name" style="color:#f00">${login}</span></span>
    </span>
    <span>: </span>
    <span data-a-target="chat-message-text" class="text-fragment">${text}</span>
    <a class="link-fragment" href="#">CatJam</a>
  </div>`;

function data(): RenderData {
  const d = emptyData();
  d.version = 'v1';
  d.emotes.set('CatJam', { src: 'data:image/webp;base64,AA==', w: 28, h: 28 });
  d.badges.set('owl-founder', { src: 'data:image/webp;base64,BB==', title: 'Основатель' });
  d.paints.gold = { id: 'gold', title: 'Золото', preset: 'gradient', colors: ['#ffcc00', '#ff8800'] };
  d.users['twitch:owl_viewer'] = { badges: ['owl-founder', 'missing'], paint: 'gold' };
  return d;
}

describe('ChatRenderer (Twitch)', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="chat">${message('owl_viewer', 'hi CatJam there')}${message('other', 'nothing here')}</div>`;
  });

  it('заменяет код смайла на картинку, ссылки не трогает', () => {
    new ChatRenderer(twitchAdapter, data()).processTree(document);
    const [first] = document.querySelectorAll('.chat-line__message');
    const imgs = first!.querySelectorAll('img.owl-emote');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.getAttribute('alt')).toBe('CatJam');
    expect(first!.querySelector('[data-a-target="chat-message-text"]')!.textContent).toBe('hi  there');
    expect(first!.querySelector('a')!.textContent).toBe('CatJam');
  });

  it('ставит иконки перед ником и эффект на ник; у других — ничего', () => {
    new ChatRenderer(twitchAdapter, data()).processTree(document);
    const [first, second] = document.querySelectorAll('.chat-line__message');
    const badges = first!.querySelectorAll('.owl-badges img');
    expect(badges).toHaveLength(1);
    expect(first!.querySelector('.owl-badges')!.nextElementSibling!.className).toBe('chat-line__username');
    const name = first!.querySelector<HTMLElement>('.chat-author__display-name')!;
    expect(name.classList.contains('owl-paint--gradient')).toBe(true);
    expect(name.style.getPropertyValue('--owl-colors')).toBe('#ffcc00, #ff8800');
    expect(second!.querySelector('.owl-badges')).toBeNull();
    expect(second!.querySelector('.owl-paint')).toBeNull();
  });

  it('повторная обработка ничего не меняет (нет зацикливания)', () => {
    const r = new ChatRenderer(twitchAdapter, data());
    r.processTree(document);
    const html = document.body.innerHTML;
    document.querySelectorAll('.chat-line__message').forEach((m) => r.processMessage(m, true));
    expect(document.body.innerHTML).toBe(html);
  });

  it('при обновлении данных снимает эффект и иконки', () => {
    const r = new ChatRenderer(twitchAdapter, data());
    r.processTree(document);
    const d = data();
    d.version = 'v2';
    d.users = {};
    r.setData(d);
    r.processTree(document);
    expect(document.querySelector('.owl-badges')).toBeNull();
    expect(document.querySelector('.owl-paint')).toBeNull();
  });
});

describe('ChatRenderer: личные настройки', () => {
  const settings = (patch: Partial<Settings>) => normalizeSettings({ ...DEFAULT_SETTINGS, ...patch });

  beforeEach(() => {
    document.body.innerHTML = `<div id="chat">${message('owl_viewer', 'hi CatJam there CatJam')}${message('spammer', 'buy CatJam')}</div>`;
  });

  it('reset возвращает сообщения к исходному виду', () => {
    const before = document.body.innerHTML;
    const r = new ChatRenderer(twitchAdapter, data(), settings({ hideUsers: ['spammer'] }));
    r.processTree(document);
    expect(document.querySelectorAll('img.owl-emote')).toHaveLength(3);
    expect(document.querySelector('.owl-collapsed .owl-reveal')).not.toBeNull();
    r.reset(document);
    // Остаётся только отметка зебры; style после снятия эффекта браузер записывает по-своему («color: #f00;»)
    const html = (h: string) => h.replace(/ data-owl-z="\d"/g, '').replace(/style="color: ?#f00;?"/g, 'style="color:#f00"');
    expect(html(document.body.innerHTML)).toBe(html(before));
    expect(document.querySelector('[data-a-target="chat-message-text"]')!.childNodes).toHaveLength(1);
  });

  it('выключенный Owl Smile ничего не трогает', () => {
    const before = document.body.innerHTML;
    new ChatRenderer(twitchAdapter, data(), settings({ enabled: false })).processTree(document);
    new ChatRenderer(twitchAdapter, data(), settings({ platforms: { twitch: false, vk: true } })).processTree(document);
    expect(document.body.innerHTML).toBe(before);
  });

  it('скрывает целиком или сворачивает; «показать» раскрывает', () => {
    const r = new ChatRenderer(twitchAdapter, data(), settings({ hideUsers: ['spammer'], filterMode: 'hide' }));
    r.processTree(document);
    const spam = document.querySelectorAll<HTMLElement>('.chat-line__message')[1]!;
    expect(spam.classList.contains('owl-hidden')).toBe(true);

    r.reset(document);
    r.setSettings(settings({ hideUsers: ['spammer'], filterMode: 'collapse' }));
    r.processTree(document);
    expect(spam.classList.contains('owl-collapsed')).toBe(true);
    spam.querySelector<HTMLButtonElement>('.owl-reveal')!.click();
    expect(spam.classList.contains('owl-collapsed')).toBe(false);
    r.processMessage(spam, true);
    expect(spam.classList.contains('owl-collapsed')).toBe(false);
  });

  it('скрытое слово находится и после замены его на смайл', () => {
    const r = new ChatRenderer(twitchAdapter, data());
    r.processTree(document);
    r.setSettings(settings({ hideWords: ['catjam'] }));
    r.processTree(document);
    expect(document.querySelectorAll('.owl-collapsed')).toHaveLength(2);
  });

  it('иконки и эффекты выключаются; время ставится живым сообщениям', () => {
    const r = new ChatRenderer(twitchAdapter, data(), settings({ badges: false, paints: false }));
    r.processTree(document);
    expect(document.querySelector('.owl-badges')).toBeNull();
    expect(document.querySelector('.owl-paint')).toBeNull();
    expect(document.querySelector('.owl-time')).toBeNull();
    const live = document.querySelectorAll('.chat-line__message')[0]!;
    r.processMessage(live, true, true);
    expect(live.querySelector('.owl-time')).not.toBeNull();
  });

  it('подложка: на нике, слой — на родителе; выключается настройкой и снимается reset', () => {
    const d = data();
    d.nameplates.set('stars', { bg: 'url("data:image/png;base64,AA==")', emoji: false, opacity: 0.5, title: 'Звёзды' });
    d.profiles['twitch:owl_viewer'] = { nameplate: 'stars' };
    const r = new ChatRenderer(twitchAdapter, d);
    r.processTree(document);
    const name = document.querySelector<HTMLElement>('[data-a-user="owl_viewer"] .chat-author__display-name')!;
    expect(name.classList.contains('owl-plate')).toBe(true);
    expect(name.style.getPropertyValue('--owl-plate-opacity')).toBe('0.5');
    expect(name.parentElement!.classList.contains('owl-plate-ctx')).toBe(true);
    // Текст ника не изменился (VK берёт ник из текста)
    expect(name.textContent).toBe('owl_viewer');
    expect(document.querySelector('[data-a-user="spammer"] .owl-plate')).toBeNull();

    r.reset(document);
    r.setSettings(settings({ nameplates: false }));
    r.processTree(document);
    expect(name.classList.contains('owl-plate')).toBe(false);
    expect(name.parentElement!.classList.contains('owl-plate-ctx')).toBe(false);
  });

  it('иконка: описание в подсказке; смайл без своей подсказки — код, источник и автор в title', () => {
    const d = data();
    d.badges.set('owl-founder', { src: 'data:image/webp;base64,BB==', title: 'Основатель', description: 'С первого стрима' });
    d.emotes.set('CatJam', { src: 'data:image/webp;base64,AA==', w: 28, h: 28, author: 'owl', createdAt: '2026-11-12T10:00:00.000Z' });
    new ChatRenderer(twitchAdapter, d, settings({ hoverPreview: false })).processTree(document);
    expect(document.querySelector('img.owl-badge')!.getAttribute('title')).toBe('Основатель — С первого стрима');
    expect(document.querySelector('img.owl-emote')!.getAttribute('title')).toBe('CatJam\n🦉 Owl Smile\nЗагрузил(а): owl, 12.11.2026');
  });

  it('подпись смайла: Owl Smile и BetterTTV (канал / глобальный)', () => {
    expect(emoteCaption('A', { src: '', w: 1, h: 1 })).toEqual(['A', '🦉 Owl Smile', null]);
    expect(emoteCaption('B', { src: '', w: 1, h: 1, bttv: true, channel: 'Forsen', author: 'someone' })).toEqual(['B', 'BetterTTV · канал Forsen', 'Автор: someone']);
    expect(emoteCaption('C', { src: '', w: 1, h: 1, bttv: true })).toEqual(['C', 'BetterTTV · глобальный', null]);
  });

  it('анимированный смайл в режиме «не двигаются» помечается для стоп-кадра', () => {
    const d = data();
    d.emotes.set('CatJam', { src: 'data:image/gif;base64,AA==', w: 28, h: 28, animated: true });
    new ChatRenderer(twitchAdapter, d, settings({ animation: 'off' })).processTree(document);
    const img = document.querySelector<HTMLImageElement>('img.owl-emote')!;
    expect(img.dataset.owlAnim).toBe('data:image/gif;base64,AA==');
  });
});
