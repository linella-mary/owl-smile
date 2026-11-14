import type { ChatAdapter } from '../platforms/types';
import { PLATFORM_TITLES, userKey } from '../shared/ids';
import { isActive, type Settings } from '../shared/settings';
import type { ChatLog } from './chat-log';
import {
  PROFILE_CSS,
  accentOf,
  chatSection,
  decoratedName,
  el,
  factsSection,
  isOwlUser,
  mineSection,
  publicSections,
  type ProfileCtx,
} from './profile-view';
import type { RenderData } from './renderer';
import { mountOnTop } from './top-layer';
// Эффекты и подложки ника — внутри Shadow DOM карточки стили страницы не действуют
import chatCss from './style.css?inline';

const CARD_CSS = `
:host { all: initial; }
.card {
  position: fixed; z-index: 2147483000; width: 310px; max-height: min(520px, calc(100vh - 16px)); overflow-y: auto;
  background: #18181b; color: #efeff1; border: 1px solid #3a3a3d; border-radius: 10px; box-shadow: 0 10px 28px #000c;
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.head { position: relative; padding: 14px 14px 12px; border-radius: 10px 10px 0 0; background: var(--accent, #2a2a30); }
.head::after { content: ''; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(#0000, #0008); pointer-events: none; }
.head > * { position: relative; z-index: 1; }
.close { position: absolute; top: 6px; right: 6px; z-index: 2; background: #0006; color: #fff; border: 0; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; font-size: 14px; line-height: 1; }
.close:hover { background: #000a; }
.name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding-right: 24px; }
.name-wrap { isolation: isolate; }
.name { font-size: 17px; font-weight: 700; color: #fff; word-break: break-word; }
.tag { font-size: 11px; color: #efeff1; background: #0006; border-radius: 4px; padding: 1px 6px; }
.body { padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
`;

const STOP_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'focusin', 'focusout', 'wheel'] as const;

/** У зрителя есть оформление или записи Owl Smile — только тогда клик по нику открывает нашу карточку. */
export function hasOwlLook(data: RenderData, key: string): boolean {
  return isOwlUser(data, key, key.slice(key.indexOf(':') + 1));
}

/**
 * Карточка профиля Owl Smile по клику на ник (или на наши иконки) — для площадок без своей
 * карточки, которую можно дополнить (VK Live). На Twitch — блок в его карточке (twitch-card.ts).
 * Обычный профиль площадки — Alt+клик или кнопка в карточке. Возвращает функцию отключения.
 */
export function installProfileCards(
  adapter: ChatAdapter,
  getData: () => RenderData,
  getSettings: () => Settings,
  log: ChatLog | null = null,
): () => void {
  let host: HTMLElement | null = null;
  /** Следующий клик по этому нику — площадке (кнопка «Профиль VK»). */
  let bypass: Element | null = null;

  const close = () => {
    host?.remove();
    host = null;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onEsc, true);
  };
  const onOutside = (e: Event) => {
    if (host && !e.composedPath().includes(host)) close();
  };
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target || e.button !== 0) return;
    const msg = target.closest(adapter.messageSelector);
    if (!msg) return;
    const name = adapter.getUsernameElement(msg);
    const onName = Boolean(name?.contains(target));
    const onBadges = Boolean(target.closest('.owl-badges'));
    if (!name || (!onName && !onBadges)) return;
    if (bypass === name) {
      bypass = null;
      return;
    }
    const s = getSettings();
    if (!isActive(s, adapter.platform) || !s.profiles || e.altKey) return;
    const login = adapter.getAuthor(msg);
    if (!login) return;
    const data = getData();
    const display = (name.textContent ?? login).replace(/:\s*$/, '').trim() || login;
    if (!isOwlUser(data, userKey(adapter.platform, login), login, display)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const ctx: ProfileCtx = {
      adapter, login, display, data, settings: s, log,
      onNative: () => {
        close();
        bypass = name;
        name.click();
      },
    };
    void open(name, ctx);
  };

  const open = async (name: HTMLElement, ctx: ProfileCtx) => {
    close();
    host = el('div', 'owl-card-host');
    for (const type of STOP_EVENTS) host.addEventListener(type, (ev) => ev.stopPropagation());
    const root = host.attachShadow({ mode: 'open' });
    const style = el('style');
    style.textContent = chatCss + PROFILE_CSS + CARD_CSS;
    const card = el('div', 'card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', `Профиль ${ctx.display}`);
    const accent = accentOf(ctx);
    if (accent) card.style.setProperty('--accent', accent);

    // Шапка: ник с эффектом и подложкой, площадка, местоимения
    const head = el('div', 'head');
    const closeBtn = el('button', 'close', '✕');
    closeBtn.title = 'Закрыть';
    closeBtn.addEventListener('click', close);
    const nameRow = el('div', 'name-row');
    nameRow.append(decoratedName(ctx), el('span', 'tag', PLATFORM_TITLES[ctx.adapter.platform]));
    const pronouns = ctx.data.profiles[userKey(ctx.adapter.platform, ctx.login)]?.pronouns;
    if (pronouns) nameRow.append(el('span', 'tag', pronouns));
    head.append(closeBtn, nameRow);

    const body = el('div', 'body');
    const facts = factsSection(ctx);
    if (facts) body.append(facts);
    const pub = publicSections(ctx);
    body.append(...pub);
    if (!pub.length) body.append(el('div', 'muted', 'Зритель пока ничего о себе не рассказал.'));
    const chat = chatSection(ctx);
    if (chat) body.append(chat);
    body.append(await mineSection(ctx));

    card.append(head, body);
    root.append(style, card);
    // Как окно смайлов: в верхнем слое и (на VK) внутри блока ввода — клик по карточке не сбросит ответ
    const container = ctx.adapter.getPickerContainer?.();
    mountOnTop(host, container ?? document.body);

    // Рядом с ником: под ним, а если снизу тесно — над ним
    const r = name.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    card.style.left = `${Math.max(8, Math.min(window.innerWidth - c.width - 8, r.left))}px`;
    const below = window.innerHeight - r.bottom - 8;
    card.style.top = below >= c.height || below >= r.top ? `${Math.min(r.bottom + 6, window.innerHeight - c.height - 8)}px` : `${Math.max(8, r.top - c.height - 6)}px`;

    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onEsc, true);
  };

  // window, фаза перехвата: раньше обработчиков площадки (React вешает свои на корень приложения)
  window.addEventListener('click', onClick, true);
  return () => {
    window.removeEventListener('click', onClick, true);
    close();
  };
}
