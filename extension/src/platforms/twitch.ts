import { textNodesIn, type ChatAdapter } from './types';

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
};
