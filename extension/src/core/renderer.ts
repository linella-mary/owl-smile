import type { ChatAdapter } from '../platforms/types';
import type { LocalProfile } from '../shared/cache';
import { isBirthdayToday, userKey } from '../shared/ids';
import type { Paint, UserCosmetics } from '../shared/schema';
import { DEFAULT_SETTINGS, isActive, settingsHash, type Settings } from '../shared/settings';
import type { ChatLog } from './chat-log';
import { classifyMessage, type Verdict } from './filters';
import { applyNameplate, applyPaint, clearNameplate, clearPaint, type PlateView } from './paint';
import { freeze } from './still';
import { tokenize } from './tokenizer';

export interface EmoteImage {
  src: string;
  /** У смайлов BetterTTV — картинка покрупнее для чётких экранов. */
  srcset?: string;
  w: number;
  h: number;
  /** Смайл BetterTTV (а не из базы Owl Smile). */
  bttv?: boolean;
  animated?: boolean;
  /** Кто загрузил: ник в Owl Smile, автор на BetterTTV. */
  author?: string;
  /** Когда добавлен (смайлы Owl Smile), ISO. */
  createdAt?: string;
  /** BetterTTV: смайл канала (его имя); нет — глобальный. */
  channel?: string;
}

/** Смайлы BetterTTV для окна смайлов: коды по разделам и состояние загрузки канала. */
export interface BttvView {
  global: string[];
  /** null — канала нет: на VK он не указан в настройках, на Twitch открыта страница без канала. */
  channel: {
    login: string;
    name: string;
    codes: string[];
    state: 'loading' | 'ok' | 'missing' | 'error';
    error?: string;
  } | null;
}

export interface RenderData {
  /** Версия данных (HEAD репозитория и списков BetterTTV) — для пропуска уже обработанных сообщений. */
  version: string;
  /** Все смайлы для чата: сначала Owl Smile, потом BetterTTV (при совпадении кода побеждает Owl Smile). */
  emotes: Map<string, EmoteImage>;
  badges: Map<string, { src: string; title: string; description?: string }>;
  paints: Record<string, Paint>;
  users: Record<string, UserCosmetics>;
  nameplates: Map<string, PlateView>;
  /** Профили зрителей (ключ — "twitch:login" / "vk:nick"). */
  profiles: Record<string, LocalProfile>;
  /** Смайлы Owl Smile по нику загрузившего (в нижнем регистре) — «его смайлы» в профиле. */
  emotesByAuthor: Map<string, string[]>;
  bttv: BttvView;
}

export const emptyData = (): RenderData => ({
  version: '',
  emotes: new Map(),
  badges: new Map(),
  paints: {},
  users: {},
  nameplates: new Map(),
  profiles: {},
  emotesByAuthor: new Map(),
  bttv: { global: [], channel: null },
});

/**
 * Подпись смайла: код, откуда (Owl Smile / BetterTTV) и кто загрузил. Для подсказки при наведении
 * и для title, если подсказка выключена.
 */
export function emoteCaption(code: string, e: EmoteImage): [code: string, source: string, author: string | null] {
  if (e.bttv) {
    const source = e.channel ? `BetterTTV · канал ${e.channel}` : 'BetterTTV · глобальный';
    return [code, source, e.author ? `Автор: ${e.author}` : null];
  }
  const date = e.createdAt ? new Date(e.createdAt) : null;
  const when = date && !Number.isNaN(date.getTime()) ? `, ${date.toLocaleDateString('ru-RU')}` : '';
  return [code, '🦉 Owl Smile', e.author ? `Загрузил(а): ${e.author}${when}` : null];
}

const HIDE_REASONS: Record<NonNullable<Verdict['reason']>, string> = {
  user: 'сообщение скрытого зрителя',
  bot: 'сообщение бота',
  word: 'скрытое слово',
};

/** Узлы, которые вставили мы (текст вокруг смайлов и сами смайлы), — чтобы reset склеил ровно их. */
const created = new WeakSet<Node>();
/** Сообщения, уже записанные в журнал чата (повторная обработка не считается новым сообщением). */
const logged = new WeakSet<Element>();

/**
 * Вставляет смайлы, иконки и эффекты в сообщения чата и применяет личные настройки
 * (фильтры, подсветка, зебра, время).
 * Все операции идемпотентны: повторная обработка сообщения ничего не меняет,
 * поэтому реакция MutationObserver на собственные изменения не зацикливается.
 */
export class ChatRenderer {
  private settings: Settings;
  private stamp: string;
  private zebra = 0;

  constructor(
    private readonly adapter: ChatAdapter,
    private data: RenderData,
    settings: Settings = DEFAULT_SETTINGS,
    /** Журнал сообщений для профиля («Сообщения в этом чате»). */
    private readonly log: ChatLog | null = null,
  ) {
    this.settings = settings;
    this.stamp = this.makeStamp();
  }

  setData(data: RenderData): void {
    this.data = data;
    this.stamp = this.makeStamp();
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
    this.stamp = this.makeStamp();
  }

  get active(): boolean {
    return isActive(this.settings, this.adapter.platform);
  }

  private makeStamp(): string {
    return `${this.data.version}#${settingsHash(this.settings)}`;
  }

  /** Обрабатывает все сообщения внутри root (и сам root, если это сообщение). `live` — см. processMessage. */
  processTree(root: ParentNode, live = false): void {
    if (root instanceof Element && root.matches(this.adapter.messageSelector)) this.processMessage(root, false, live);
    root.querySelectorAll(this.adapter.messageSelector).forEach((m) => this.processMessage(m, false, live));
  }

  /**
   * `force` — обработать заново, даже если уже обработано; `live` — сообщение только что пришло
   * (ему ставится время).
   */
  processMessage(msg: Element, force = false, live = false): void {
    if (!this.active) return;
    const el = msg as HTMLElement;
    if (live && !el.dataset.owlTs) el.dataset.owlTs = String(Date.now());
    if (!force && el.dataset.owl === this.stamp) return;
    el.dataset.owl = this.stamp;
    el.dataset.owlZ ??= String(this.zebra++ % 2);

    const author = this.adapter.getAuthor(msg);
    // Текст — до замены кодов на картинки (у уже обработанного сообщения коды берём из alt)
    const text = this.messageText(msg);
    const verdict = classifyMessage(text, author, this.settings, this.adapter.platform);
    if (this.log && author && !logged.has(el)) {
      logged.add(el);
      this.log.add(userKey(this.adapter.platform, author), text, Number(el.dataset.owlTs) || undefined);
    }
    this.renderEmotes(msg);
    this.renderCosmetics(msg, author);
    this.renderTime(el);
    this.renderVerdict(el, verdict);
  }

  /** Возвращает сообщения внутри root к исходному виду (Owl Smile выключен или настройки сменились). */
  reset(root: ParentNode): void {
    const msgs = [...root.querySelectorAll<HTMLElement>('[data-owl]')];
    if (root instanceof HTMLElement && root.dataset.owl !== undefined) msgs.push(root);
    for (const el of msgs) this.resetMessage(el);
  }

  private resetMessage(el: HTMLElement): void {
    for (const img of el.querySelectorAll<HTMLImageElement>('img.owl-emote')) {
      if (!img.parentNode) continue; // уже склеен вместе с соседним
      // Склеиваем непрерывный ряд наших узлов (текст + смайлы) обратно в один текстовый узел
      let first: ChildNode = img;
      while (first.previousSibling && created.has(first.previousSibling)) first = first.previousSibling;
      let text = '';
      const run: ChildNode[] = [];
      for (let n: ChildNode | null = first; n && (n === img || created.has(n)); n = n.nextSibling) {
        run.push(n);
        text += n instanceof HTMLImageElement ? n.alt : (n.textContent ?? '');
      }
      run[0]!.before(document.createTextNode(text));
      for (const n of run) n.remove();
    }
    el.querySelectorAll('.owl-badges, .owl-time, .owl-reveal').forEach((n) => n.remove());
    const name = this.adapter.getUsernameElement(el);
    if (name) {
      clearPaint(name);
      clearNameplate(name);
    }
    el.classList.remove('owl-hidden', 'owl-collapsed', 'owl-hl');
    delete el.dataset.owl;
  }

  /** Текст сообщения для фильтров: текстовые узлы + коды уже вставленных смайлов. */
  private messageText(msg: Element): string {
    const parts = this.adapter.getTextNodes(msg).map((t) => t.data);
    msg.querySelectorAll<HTMLImageElement>('img.owl-emote').forEach((img) => parts.push(img.alt));
    return parts.join(' ');
  }

  private renderEmotes(msg: Element): void {
    const { emotes } = this.data;
    if (!emotes.size) return;
    const { animation, hoverPreview } = this.settings;
    for (const node of this.adapter.getTextNodes(msg)) {
      if (!node.parentNode) continue;
      // Ссылки и наши иконки пропускаем — но только внутри самого сообщения: если площадка обернула
      // в <a> всё сообщение или цитату ответа («перейти к сообщению»), смайлы там всё равно нужны
      const skip = node.parentElement?.closest('a, .owl-badges, .owl-reveal');
      if (skip && msg.contains(skip)) continue;
      const tokens = tokenize(node.data, (c) => emotes.has(c));
      if (!tokens) continue;
      const frag = document.createDocumentFragment();
      for (const t of tokens) {
        let n: Node;
        if (t.type === 'text') {
          n = document.createTextNode(t.value);
        } else {
          const e = emotes.get(t.code)!;
          const img = document.createElement('img');
          img.className = 'owl-emote';
          img.src = e.src;
          if (e.srcset) img.srcset = e.srcset;
          img.alt = t.code;
          // Своя подсказка вместо системной (см. hover.ts); без неё — та же информация в title
          if (!hoverPreview) img.title = emoteCaption(t.code, e).join('\n');
          img.decoding = 'async';
          img.draggable = false;
          if (e.animated && animation !== 'always') {
            img.dataset.owlAnim = e.src;
            if (e.srcset) img.dataset.owlSrcset = e.srcset;
            freeze(img);
          }
          n = img;
        }
        created.add(n);
        frag.append(n);
      }
      node.replaceWith(frag);
    }
  }

  private renderCosmetics(msg: Element, login: string | null): void {
    const who = login ? userKey(this.adapter.platform, login) : null;
    const user = who ? this.data.users[who] : undefined;
    const plateId = who && this.settings.nameplates ? this.data.profiles[who]?.nameplate : undefined;

    const name = this.adapter.getUsernameElement(msg);
    if (name) {
      applyPaint(name, this.settings.paints && user?.paint ? this.data.paints[user.paint] : null);
      applyNameplate(name, plateId ? (this.data.nameplates.get(plateId) ?? null) : null);
    }

    const ids = this.settings.badges ? (user?.badges ?? []).filter((id) => this.data.badges.has(id)) : [];
    // В день рождения (из профиля) — 🎂 рядом с иконками
    const bday = Boolean(who && isBirthdayToday(this.data.profiles[who]?.birthday));
    const key = [...ids, ...(bday ? ['🎂'] : [])].join(',');
    const existing = msg.querySelector<HTMLElement>('.owl-badges');
    if ((existing?.dataset.key ?? '') === key) return;
    existing?.remove();
    if (!key) return;
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
      img.title = b.description ? `${b.title} — ${b.description}` : b.title;
      box.append(img);
    }
    if (bday) {
      const cake = document.createElement('span');
      cake.className = 'owl-bday';
      cake.textContent = '🎂';
      cake.title = 'Сегодня день рождения';
      box.append(cake);
    }
    anchor.before(box);
  }

  /** Время прихода сообщения — в начале строки автора. Видно, только если включено (класс owl-ts). */
  private renderTime(msg: HTMLElement): void {
    const ts = Number(msg.dataset.owlTs);
    if (!ts || this.adapter.ownTimestamps || msg.querySelector('.owl-time')) return;
    const anchor = this.adapter.getBadgeAnchor(msg);
    const parent = anchor?.parentElement;
    if (!parent || !msg.contains(parent)) return;
    const span = document.createElement('span');
    span.className = 'owl-time';
    span.textContent = new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    parent.prepend(span);
  }

  private renderVerdict(el: HTMLElement, v: Verdict): void {
    el.classList.toggle('owl-hl', v.highlight);
    const hide = v.hide && el.dataset.owlRevealed !== '1';
    const collapse = hide && this.settings.filterMode === 'collapse';
    el.classList.toggle('owl-hidden', hide && !collapse);
    el.classList.toggle('owl-collapsed', collapse);
    const existing = el.querySelector(':scope > .owl-reveal');
    if (!collapse) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'owl-reveal';
    btn.textContent = `Скрыто: ${HIDE_REASONS[v.reason ?? 'word']} — показать`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.dataset.owlRevealed = '1';
      el.classList.remove('owl-collapsed');
      btn.remove();
    });
    el.prepend(btn);
  }
}
