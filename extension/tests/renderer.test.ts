// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { ChatRenderer, emptyData, type RenderData } from '../src/core/renderer';
import { twitchAdapter } from '../src/platforms/twitch';

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
