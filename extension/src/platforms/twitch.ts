import { textNodesIn, type ChatAdapter, outerWrapper } from './types';

/**
 * Twitch (twitch.tv, popout-чат, VOD-чат).
 * Селекторы нужно сверить на живой странице (этап 0.2) — Twitch меняет вёрстку.
 * С включённым 7TV сообщения рисуются его собственной вёрсткой (.seventv-message) — не поддерживается.
 */
export const twitchAdapter: ChatAdapter = {
  platform: 'twitch',
  messageSelector: '.chat-line__message, .vod-message',
  profileMode: 'augment',

  getAuthor(msg) {
    const login =
      msg.getAttribute('data-a-user') ??
      msg.querySelector('[data-a-user]')?.getAttribute('data-a-user') ??
      this.getUsernameElement(msg)?.textContent?.trim();
    return login ? login.toLowerCase() : null;
  },

  getUsernameElement(msg) {
    return msg.querySelector<HTMLElement>('.chat-author__display-name, [data-a-target="chat-message-username"]');
  },

  getBadgeAnchor(msg) {
    const name = this.getUsernameElement(msg);
    return name?.closest('.chat-line__username') ?? name;
  },

  getTextNodes(msg) {
    return textNodesIn(msg.querySelectorAll('.text-fragment, [data-a-target="chat-message-text"]'));
  },

  getChatInput() {
    return document.querySelector<HTMLElement>('[data-a-target="chat-input"]');
  },

  getPickerAnchor() {
    return document.querySelector('[data-a-target="emote-picker-button"]')?.closest('div') ?? null;
  },

  // Ряд под полем ввода: баллы канала слева, справа шестерёнка настроек чата и «Чат». Сова — перед шестерёнкой.
  getPickerToolbarAnchor() {
    const gear = document.querySelector('[data-a-target="chat-settings"]');
    return gear ? outerWrapper(gear) : null;
  },

  // У модератора в ряду ещё щит и меч: с совой ряд не помещается, и «Чат» уезжает на строку выше
  toolbarWraps() {
    const gear = document.querySelector('[data-a-target="chat-settings"]');
    const send = document.querySelector('[data-a-target="chat-send-button"]');
    if (!gear || !send) return false;
    const g = gear.getBoundingClientRect();
    const b = send.getBoundingClientRect();
    if (!g.height || !b.height) return false;
    return Math.abs(g.top + g.height / 2 - (b.top + b.height / 2)) > Math.max(g.height, b.height) / 2;
  },
};
