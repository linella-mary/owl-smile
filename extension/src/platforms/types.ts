import type { Platform } from '../shared/ids';

/** Всё, что зависит от вёрстки площадки, — только здесь. */
export interface ChatAdapter {
  platform: Platform;
  /** CSS-селектор одного сообщения чата. */
  messageSelector: string;
  /** Ник автора (в нижнем регистре) — ключ для иконок и эффектов. */
  getAuthor(message: Element): string | null;
  /** Элемент с ником — к нему применяется эффект. */
  getUsernameElement(message: Element): HTMLElement | null;
  /** Перед каким элементом вставлять иконки. */
  getBadgeAnchor(message: Element): Element | null;
  /** Текстовые узлы тела сообщения (без ссылок, упоминаний, ника). */
  getTextNodes(message: Element): Text[];
  /** Поле ввода чата. */
  getChatInput(): HTMLElement | null;
  /** Элемент, рядом с которым ставится кнопка смайлов. */
  getPickerAnchor(): Element | null;
}

/** Все текстовые узлы внутри элементов. */
export function textNodesIn(roots: Iterable<Element>): Text[] {
  const out: Text[] = [];
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  }
  return out;
}
