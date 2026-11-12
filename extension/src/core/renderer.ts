import type { ChatAdapter } from '../platforms/types';
import { userKey } from '../shared/ids';
import type { Paint, UserCosmetics } from '../shared/schema';
import { applyPaint } from './paint';
import { tokenize } from './tokenizer';

export interface RenderData {
  /** Версия данных (HEAD репозитория) — для пропуска уже обработанных сообщений. */
  version: string;
  emotes: Map<string, { src: string; w: number; h: number }>;
  badges: Map<string, { src: string; title: string }>;
  paints: Record<string, Paint>;
  users: Record<string, UserCosmetics>;
}

export const emptyData = (): RenderData => ({ version: '', emotes: new Map(), badges: new Map(), paints: {}, users: {} });

/**
 * Вставляет смайлы, иконки и эффекты в сообщения чата.
 * Все операции идемпотентны: повторная обработка сообщения ничего не меняет,
 * поэтому реакция MutationObserver на собственные изменения не зацикливается.
 */
export class ChatRenderer {
  constructor(
    private readonly adapter: ChatAdapter,
    private data: RenderData,
  ) {}

  setData(data: RenderData): void {
    this.data = data;
  }

  /** Обрабатывает все сообщения внутри root (и сам root, если это сообщение). */
  processTree(root: ParentNode): void {
    if (root instanceof Element && root.matches(this.adapter.messageSelector)) this.processMessage(root);
    root.querySelectorAll(this.adapter.messageSelector).forEach((m) => this.processMessage(m));
  }

  processMessage(msg: Element, force = false): void {
    const el = msg as HTMLElement;
    if (!force && el.dataset.owl === this.data.version) return;
    el.dataset.owl = this.data.version;
    this.renderEmotes(msg);
    this.renderCosmetics(msg);
  }

  private renderEmotes(msg: Element): void {
    const { emotes } = this.data;
    if (!emotes.size) return;
    for (const node of this.adapter.getTextNodes(msg)) {
      if (!node.parentNode || node.parentElement?.closest('a, .owl-badges')) continue;
      const tokens = tokenize(node.data, (c) => emotes.has(c));
      if (!tokens) continue;
      const frag = document.createDocumentFragment();
      for (const t of tokens) {
        if (t.type === 'text') {
          frag.append(document.createTextNode(t.value));
        } else {
          const e = emotes.get(t.code)!;
          const img = document.createElement('img');
          img.className = 'owl-emote';
          img.src = e.src;
          img.alt = t.code;
          img.title = t.code;
          img.decoding = 'async';
          img.draggable = false;
          frag.append(img);
        }
      }
      node.replaceWith(frag);
    }
  }

  private renderCosmetics(msg: Element): void {
    const login = this.adapter.getAuthor(msg);
    const user = login ? this.data.users[userKey(this.adapter.platform, login)] : undefined;

    const name = this.adapter.getUsernameElement(msg);
    if (name) applyPaint(name, user?.paint ? this.data.paints[user.paint] : null);

    const ids = (user?.badges ?? []).filter((id) => this.data.badges.has(id));
    const key = ids.join(',');
    const existing = msg.querySelector<HTMLElement>('.owl-badges');
    if ((existing?.dataset.key ?? '') === key) return;
    existing?.remove();
    if (!ids.length) return;
    const anchor = this.adapter.getBadgeAnchor(msg);
    if (!anchor) return;

    const box = document.createElement('span');
    box.className = 'owl-badges';
    box.dataset.key = key;
    for (const id of ids) {
      const b = this.data.badges.get(id)!;
      const img = document.createElement('img');
      img.className = 'owl-badge';
      img.src = b.src;
      img.alt = b.title;
      img.title = b.title;
      box.append(img);
    }
    anchor.before(box);
  }
}
