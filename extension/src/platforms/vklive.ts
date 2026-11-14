import { normalizeNick } from '../shared/ids';
import { textNodesIn, type ChatAdapter } from './types';

/**
 * VK Live (live.vkvideo.ru). Разметка снята с живой страницы 2026-11-12.
 * Классы — CSS-модули с хешем в конце (ChatMessage_root_UHMEJ), хеш может меняться между релизами,
 * поэтому опираемся на data-атрибуты и на стабильную часть имени класса ([class*="…_"]).
 *
 *   [data-role="messageContainer"]           — сообщение
 *     [data-role="messageAuthor"]            — блок автора: значки VK + ник
 *       [class*="ChatMessageAuthorPanel_name_"]  — «Ник:» (с двоеточием в конце)
 *     [data-role="markup"]                   — текст сообщения
 *
 * Поле ввода (видно только после входа) — Editor.js внутри ChatPublisher:
 *   [class*="Publisher_editor_"] [contenteditable="true"], кнопка смайлов — [class*="Publisher_smileContainer_"].
 */
export const vkliveAdapter: ChatAdapter = {
  platform: 'vk',
  messageSelector: '[data-role="messageContainer"]',
  // У каждого сообщения VK уже есть время (ChatMessage_publishTime_)
  ownTimestamps: true,
  profileMode: 'card',

  getAuthor(msg) {
    const raw = this.getUsernameElement(msg)?.textContent;
    return raw ? normalizeNick(raw) : null;
  },

  getUsernameElement(msg) {
    return msg.querySelector<HTMLElement>('[data-role="messageAuthor"] [class*="ChatMessageAuthorPanel_name_"]');
  },

  getBadgeAnchor(msg) {
    return this.getUsernameElement(msg);
  },

  getTextNodes(msg) {
    return textNodesIn(msg.querySelectorAll('[data-role="markup"]'));
  },

  getChatInput() {
    return (
      document.querySelector<HTMLElement>('[class*="Publisher_editor_"] [contenteditable="true"]') ??
      document.querySelector<HTMLElement>('[class*="ChatPublisher_"] [contenteditable="true"]')
    );
  },

  // Окно смайлов — внутри блока ввода: клик по окну вне его VK в режиме ответа принимал за «клик мимо»
  // и сбрасывал ответ вместе с набранным текстом (жалоба 14.11.2026). Блок ввода — position: relative,
  // z-index 10, без transform: окно с position: fixed внутри него видно поверх чата (проверено на живом VK).
  getPickerContainer() {
    return document.getElementById('chat-pub-root') ?? document.querySelector('[class*="ChatPublisher_root_"]');
  },

  getPickerAnchor() {
    return (
      document.querySelector('[class*="Publisher_smileContainer_"]') ??
      document.querySelector('[class*="ChatPublisher_smileSelector_"]') ??
      document.querySelector('[class*="Publisher_sendContainer_"]')
    );
  },
};
