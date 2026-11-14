import type { ChatAdapter } from '../platforms/types';
import { userKey } from '../shared/ids';
import { isActive, type Settings } from '../shared/settings';
import type { ChatLog } from './chat-log';
import { PROFILE_CSS, chatSection, el, factsSection, isOwlUser, mineSection, publicSections, type ProfileCtx } from './profile-view';
import type { RenderData } from './renderer';
import chatCss from './style.css?inline';

/**
 * Блок Owl Smile в карточке зрителя Twitch (той, что открывается по клику на ник): карточка Twitch
 * остаётся как есть — с подпиской, отслеживанием, личными сообщениями, — а в неё под шапку
 * вставляется наш блок. У пользователей Owl Smile — профиль; у остальных — компактная строка
 * с сообщениями в этом чате, заметкой и кнопками.
 *
 * Вёрстка карточки Twitch снята не с живой страницы — селекторы с запасом (см. CARD_SELECTORS).
 */
export const CARD_SELECTORS = '[data-a-target="viewer-card"], .viewer-card';
/** Сколько ждать появления карточки после клика по нику. */
const WAIT_MS = 3000;
const HOST_CLASS = 'owl-vc-host';

const BLOCK_CSS = `
:host { all: initial; display: block; }
.block {
  margin: 8px 10px; padding: 10px 12px; border-radius: 8px; background: #1f1f23; border: 1px solid #9147ff55;
  color: #efeff1; font: 13px/1.4 Inter, Roobert, 'Helvetica Neue', Helvetica, Arial, sans-serif;
  max-height: 340px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;
}
.block.compact { border-color: #3a3a3d; }
.title { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 12px; color: #d2b8ff; }
`;

const STOP_EVENTS = ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'wheel'] as const;

function details(summary: string, content: Node[], open = false): HTMLDetailsElement {
  const d = el('details');
  d.open = open;
  d.append(el('summary', undefined, summary), ...content);
  return d;
}

export function installTwitchCards(
  adapter: ChatAdapter,
  getData: () => RenderData,
  getSettings: () => Settings,
  log: ChatLog | null,
): () => void {
  let clicked: { login: string; display: string; at: number } | null = null;
  let poll: ReturnType<typeof setTimeout> | undefined;

  /** Шапка карточки: самый внешний элемент с «viewer-card-header» в классе, внутри карточки. */
  const headerOf = (card: Element): Element | null => {
    let h = card.querySelector('[class*="viewer-card-header"]');
    while (h?.parentElement && h.parentElement !== card && /viewer-card-header/.test(h.parentElement.className)) h = h.parentElement;
    return h;
  };

  const inject = async (card: Element, who: { login: string; display: string }) => {
    const existing = card.querySelector<HTMLElement>(`.${HOST_CLASS}`);
    if (existing?.dataset.login === who.login) return;
    existing?.remove();

    const s = getSettings();
    const data = getData();
    const ctx: ProfileCtx = { adapter, login: who.login, display: who.display, data, settings: s, log };
    const owl = isOwlUser(data, userKey(adapter.platform, who.login), who.login, who.display);

    const host = el('div', HOST_CLASS);
    host.dataset.login = who.login;
    for (const type of STOP_EVENTS) host.addEventListener(type, (ev) => ev.stopPropagation());
    const root = host.attachShadow({ mode: 'open' });
    const style = el('style');
    style.textContent = chatCss + PROFILE_CSS + BLOCK_CSS;
    const block = el('div', owl ? 'block' : 'block compact');
    const chat = chatSection(ctx);
    const mine = await mineSection(ctx);

    if (owl) {
      const facts = factsSection(ctx);
      if (facts) block.append(facts);
      block.append(...publicSections(ctx));
      // Длинное — свёрнуто, чтобы карточка Twitch не растягивалась
      if (chat) block.append(details('Сообщения в этом чате', [chat]));
      block.append(details('Заметка и действия', [mine]));
    } else {
      const { count } = log?.get(userKey(adapter.platform, who.login)) ?? { count: 0 };
      const title = el('div', 'title', `🦉 Owl Smile · сообщений в этом чате: ${count}`);
      block.append(title, details('Сообщения, заметка, действия', [...(chat ? [chat] : []), mine]));
    }
    root.append(style, block);

    // Twitch мог пересобрать карточку, пока мы читали заметку
    if (!card.isConnected) return;
    const header = headerOf(card);
    if (header?.parentElement) header.after(host);
    else card.prepend(host);
  };

  /** После клика по нику ждём карточку Twitch (она появляется не сразу) и вставляем блок. */
  const waitForCard = () => {
    clearTimeout(poll);
    const tick = () => {
      if (!clicked || Date.now() - clicked.at > WAIT_MS) return;
      const card = document.querySelector(CARD_SELECTORS);
      if (card) {
        void inject(card, clicked);
        // Карточка может перерисоваться (загрузились значки) — проверим ещё пару раз
        if (Date.now() - clicked.at < WAIT_MS) poll = setTimeout(tick, 400);
        return;
      }
      poll = setTimeout(tick, 100);
    };
    tick();
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target || e.button !== 0) return;
    const msg = target.closest(adapter.messageSelector);
    if (!msg) return;
    const name = adapter.getUsernameElement(msg);
    // Ник: сам элемент ника или кнопка вокруг него (.chat-line__username)
    const onName = Boolean(name && (name.contains(target) || target.closest('.chat-line__username')?.contains(name)));
    if (!name || !onName) return;
    const s = getSettings();
    if (!isActive(s, adapter.platform) || !s.profiles) return;
    const login = adapter.getAuthor(msg);
    if (!login) return;
    clicked = { login, display: (name.textContent ?? login).trim() || login, at: Date.now() };
    waitForCard();
  };

  // Только запоминаем, кого открыли: карточку открывает сам Twitch
  window.addEventListener('click', onClick, true);
  return () => {
    window.removeEventListener('click', onClick, true);
    clearTimeout(poll);
    document.querySelectorAll(`.${HOST_CLASS}`).forEach((n) => n.remove());
  };
}
