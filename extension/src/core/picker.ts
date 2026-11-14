import { browser } from 'wxt/browser';
import type { ChatAdapter } from '../platforms/types';
import type { OwlMessage } from '../shared/messages';
import type { RenderData } from './renderer';

const BTN_ID = 'owl-picker-btn';
const K_RECENT = 'owl:recent';
const K_RECENT_BTTV = 'owl:recent-bttv';
const K_TAB = 'owl:picker-tab';
const MAX_RECENT = 16;

type Tab = 'owl' | 'bttv';

/**
 * Отправляет редактору событие beforeinput. true — редактор обработал его сам (preventDefault).
 * Так работают редакторы с собственной моделью текста (Slate на Twitch): изменения DOM в обход
 * beforeinput они не видят, и в чат ушёл бы старый текст.
 */
function dispatchBeforeInput(target: HTMLElement, inputType: string, data: string | null): boolean {
  const ev = new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true, composed: true });
  target.dispatchEvent(ev);
  return ev.defaultPrevented;
}

/**
 * Стирает `deleteCount` символов перед кареткой и вставляет `text`.
 * Сначала — через beforeinput (для Slate и подобных), если редактор не обработал — через execCommand
 * (обычный contenteditable, Editor.js на VK Live).
 */
export function editBeforeCaret(input: HTMLElement, deleteCount: number, text: string): void {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    const end = input.selectionStart ?? input.value.length;
    input.setRangeText(text, Math.max(0, end - deleteCount), input.selectionEnd ?? end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  const active = document.activeElement;
  const target = active instanceof HTMLElement && input.contains(active) ? active : input;
  for (let i = 0; i < deleteCount; i++) {
    if (!dispatchBeforeInput(target, 'deleteContentBackward', null)) document.execCommand('delete', false);
  }
  if (text && !dispatchBeforeInput(target, 'insertText', text)) document.execCommand('insertText', false, text);
}

/** Нередактируемая вставка в поле ввода: чип упоминания в ответе, смайл площадки. */
const isChip = (n: Node | null): boolean => n instanceof Element && n.getAttribute('contenteditable') === 'false';

/**
 * Точка «конец сообщения» в поле ввода — [узел, смещение]. Спускаемся по последним потомкам:
 * текст — в его конец; пустая строка (<br>) — перед <br>; чип — сразу после него (а не перед ним:
 * иначе код смайла встал бы между текстом и ником).
 */
export function endPoint(input: HTMLElement): [Node, number] {
  let node: Node = input;
  for (;;) {
    let last = node.lastChild;
    while (last && !(last instanceof Element) && !(last instanceof Text)) last = last.previousSibling; // комментарии
    if (!last) return [node, 0];
    const index = Array.prototype.indexOf.call(node.childNodes, last) as number;
    if (isChip(last)) return [node, index + 1];
    if (last instanceof Text) return [last, last.data.length];
    if (last.nodeName === 'BR') {
      const prev = last.previousSibling;
      return prev instanceof Text ? [prev, prev.data.length] : [node, index];
    }
    node = last;
  }
}

/** Каретка — в конец сообщения. */
export function caretToEnd(input: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel) return;
  const [node, offset] = endPoint(input);
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/**
 * Вставка кода смайла из окна смайлов — всегда в конец сообщения. Раньше код вставлялся туда, где
 * стояла каретка, а после клика по окну смайлов она оказывается в начале поля: код вставал перед
 * текстом и перед ником в ответе.
 */
export async function insertIntoChat(adapter: ChatAdapter, code: string): Promise<boolean> {
  const input = adapter.getChatInput();
  if (!input) return false;
  input.focus();
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    input.setSelectionRange(input.value.length, input.value.length);
  } else {
    caretToEnd(input);
  }
  // Редакторы (Slate) синхронизируют выделение по selectionchange с задержкой ~100 мс.
  await new Promise((r) => setTimeout(r, 120));
  const before = textBeforeCaret(input);
  editBeforeCaret(input, 0, (before && !/\s$/.test(before) ? ' ' : '') + code + ' ');
  return true;
}

function textBeforeCaret(input: HTMLElement): string {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement)
    return input.value.slice(0, input.selectionStart ?? input.value.length);
  const sel = window.getSelection();
  if (!sel?.rangeCount) return input.textContent ?? '';
  const r = document.createRange();
  r.selectNodeContents(input);
  r.setEnd(sel.anchorNode!, sel.anchorOffset);
  // contenteditable хранит пробел в конце как неразрывный.
  return r.toString().replace(/ /g, ' ');
}

/**
 * Набранный текст перед кареткой для автодополнения: только после последнего чипа (упоминание в ответе,
 * смайл площадки). chip — такой чип перед кареткой есть.
 */
export function typedBeforeCaret(input: HTMLElement): { before: string; chip: boolean } {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) return { before: textBeforeCaret(input), chip: false };
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.anchorNode || !input.contains(sel.anchorNode)) return { before: textBeforeCaret(input), chip: false };
  const r = document.createRange();
  r.selectNodeContents(input);
  r.setEnd(sel.anchorNode, sel.anchorOffset);
  const chips = input.querySelectorAll('[contenteditable="false"]');
  for (let i = chips.length - 1; i >= 0; i--) {
    const chip = chips[i]!;
    const parent = chip.parentNode;
    if (!parent) continue;
    // Чип внутри другого чипа — считаем по внешнему
    const outer = chip.parentElement?.closest('[contenteditable="false"]');
    if (outer && input.contains(outer)) continue;
    const after = (Array.prototype.indexOf.call(parent.childNodes, chip) as number) + 1;
    if (r.comparePoint(parent, after) > 0) continue; // чип после каретки
    const tail = document.createRange();
    tail.setStart(parent, after);
    tail.setEnd(sel.anchorNode, sel.anchorOffset);
    return { before: tail.toString().replace(/\u00a0/g, ' '), chip: true };
  }
  return { before: r.toString().replace(/\u00a0/g, ' '), chip: false };
}

const recentKey = (tab: Tab) => (tab === 'bttv' ? K_RECENT_BTTV : K_RECENT);

async function getRecent(tab: Tab): Promise<string[]> {
  const key = recentKey(tab);
  return ((await browser.storage.local.get(key))[key] as string[] | undefined) ?? [];
}
async function pushRecent(tab: Tab, code: string): Promise<void> {
  const list = [code, ...(await getRecent(tab)).filter((c) => c !== code)].slice(0, MAX_RECENT);
  await browser.storage.local.set({ [recentKey(tab)]: list });
}

const STOP_EVENTS = [
  'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend',
  'keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'focusin', 'focusout', 'wheel',
] as const;

/**
 * Предок с transform, filter и т. п. делает position: fixed относительным к себе — окно смайлов
 * внутри такого контейнера встанет не туда. Тогда окно вставляется в body.
 */
export function trapsFixed(el: Element): boolean {
  for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (
      (s.transform && s.transform !== 'none') ||
      (s.filter && s.filter !== 'none') ||
      (s.perspective && s.perspective !== 'none') ||
      /paint|layout|strict|content/.test(s.contain ?? '') ||
      /transform|filter|perspective/.test(s.willChange ?? '') ||
      (s.backdropFilter && s.backdropFilter !== 'none')
    )
      return true;
  }
  return false;
}

const PANEL_CSS = `
:host { all: initial; }
.panel {
  position: fixed; z-index: 2147483000; width: 320px; max-height: 360px; display: flex; flex-direction: column;
  background: #18181b; color: #efeff1; border: 1px solid #3a3a3d; border-radius: 8px; box-shadow: 0 8px 24px #000a;
  font: 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.tabs { display: flex; border-bottom: 1px solid #3a3a3d; }
.tabs button { flex: 1; background: none; color: #adadb8; border: 0; border-bottom: 2px solid transparent; padding: 8px 6px 6px; font: inherit; font-weight: 600; cursor: pointer; }
.tabs button:hover { color: #efeff1; }
.tabs button[aria-selected="true"] { color: #efeff1; border-bottom-color: #9147ff; }
.head { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid #3a3a3d; }
input { flex: 1; background: #0e0e10; color: inherit; border: 1px solid #3a3a3d; border-radius: 6px; padding: 6px 8px; font: inherit; outline: none; }
input:focus { border-color: #9147ff; }
button.add { background: #9147ff; color: #fff; border: 0; border-radius: 6px; width: 30px; font-size: 18px; cursor: pointer; }
.body { overflow-y: auto; padding: 6px 8px 8px; }
.label { color: #adadb8; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin: 6px 0 4px; }
.grid { display: flex; flex-wrap: wrap; gap: 2px; }
.grid button { background: none; border: 0; border-radius: 4px; padding: 3px; cursor: pointer; height: 38px; min-width: 38px; display: flex; align-items: center; justify-content: center; }
.grid button:hover, .grid button:focus-visible { background: #ffffff1f; outline: none; }
.grid img { height: 28px; max-width: 100px; }
.empty { color: #adadb8; padding: 12px 4px; text-align: center; }
.note { color: #adadb8; font-size: 12px; padding: 2px 2px 6px; }
.note.err { color: #ff8a8a; }
`;

/** Кнопка смайлов возле поля ввода + всплывающая сетка (Shadow DOM, стили площадки не влияют). */
export class EmotePicker {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private redraw: (() => void) | null = null;

  constructor(
    private readonly adapter: ChatAdapter,
    private readonly getData: () => RenderData,
  ) {}

  /** Вызывать при изменениях DOM: ставит кнопку, если её ещё нет. */
  ensureButton(): void {
    if (document.getElementById(BTN_ID)) return;
    const anchor = this.adapter.getPickerAnchor();
    if (!anchor) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.title = 'Смайлы Owl Smile';
    btn.setAttribute('aria-label', 'Смайлы Owl Smile');
    btn.textContent = '🦉';
    // Центр по вертикали — флексом и align-self, а не line-height: в строке кнопок VK Live сова
    // с line-height 30px стояла выше их значков
    Object.assign(btn.style, {
      background: 'none', border: '0', cursor: 'pointer', fontSize: '18px', padding: '0 6px', margin: '0',
      height: '30px', minWidth: '30px', borderRadius: '4px', lineHeight: '1',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
      verticalAlign: 'middle', flexShrink: '0',
    } satisfies Partial<CSSStyleDeclaration>);
    btn.addEventListener('mouseenter', () => (btn.style.background = '#ffffff1f'));
    btn.addEventListener('mouseleave', () => (btn.style.background = 'none'));
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.host) this.close();
      else void this.open(btn);
    });
    anchor.before(btn);
  }

  /** Убрать кнопку и окно (при выключении скрипта). */
  dispose(): void {
    this.close();
    document.getElementById(BTN_ID)?.remove();
  }

  /** Данные обновились (например, догрузились смайлы канала) — перерисовать открытое окно. */
  refresh(): void {
    this.redraw?.();
  }

  close(): void {
    this.host?.remove();
    this.host = this.root = null;
    this.redraw = null;
    document.removeEventListener('pointerdown', this.onOutside, true);
    document.removeEventListener('keydown', this.onKey, true);
  }

  private onOutside = (e: Event) => {
    if (this.host && !e.composedPath().includes(this.host) && (e.target as Element)?.id !== BTN_ID) this.close();
  };
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  private async open(btn: HTMLElement): Promise<void> {
    const saved = (await browser.storage.local.get(K_TAB))[K_TAB];
    let tab: Tab = saved === 'bttv' ? 'bttv' : 'owl';
    const recent: Record<Tab, string[]> = { owl: await getRecent('owl'), bttv: await getRecent('bttv') };
    this.host = document.createElement('div');
    this.host.className = 'owl-picker-host';
    // События окна до площадки не доходят: её обработчики «клик мимо», горячие клавиши, Enter и Esc
    // в поле ввода не должны срабатывать от кликов и набора в окне смайлов. Наши собственные
    // обработчики (кнопки окна, закрытие по клику мимо и Esc) срабатывают раньше.
    for (const type of STOP_EVENTS) this.host.addEventListener(type, (e) => e.stopPropagation());
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML =
      `<div class="tabs" role="tablist"><button role="tab" data-tab="owl">🦉 Owl Smile</button><button role="tab" data-tab="bttv">BetterTTV</button></div>` +
      `<div class="head"><input type="search" placeholder="Поиск смайла"><button class="add" title="Загрузить свой смайл">+</button></div><div class="body"></div>`;
    this.root.append(style, panel);
    const container = this.adapter.getPickerContainer?.();
    (container && !trapsFixed(container) ? container : document.body).append(this.host);

    // Открываем над кнопкой (как обычно у поля чата), а если сверху тесно — под ней.
    const r = btn.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(window.innerWidth - 328, r.right - 320))}px`;
    const above = r.top - 14;
    const below = window.innerHeight - r.bottom - 14;
    if (above >= 360 || above >= below) {
      panel.style.bottom = `${window.innerHeight - r.top + 6}px`;
      panel.style.maxHeight = `${Math.min(360, above)}px`;
    } else {
      panel.style.top = `${r.bottom + 6}px`;
      panel.style.maxHeight = `${Math.min(360, below)}px`;
    }

    const input = panel.querySelector('input')!;
    const body = panel.querySelector<HTMLElement>('.body')!;
    const add = panel.querySelector<HTMLElement>('.add')!;
    add.addEventListener('click', () => {
      void browser.runtime.sendMessage({ type: 'owl:open-manage' } satisfies OwlMessage);
      this.close();
    });
    const tabs = [...panel.querySelectorAll<HTMLButtonElement>('.tabs button')];
    const draw = () => {
      for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
      add.hidden = tab !== 'owl'; // загрузить можно только в базу Owl Smile
      this.renderGrid(body, tab, input.value.trim().toLowerCase(), recent[tab]);
    };
    for (const t of tabs) {
      t.addEventListener('click', () => {
        tab = t.dataset.tab === 'bttv' ? 'bttv' : 'owl';
        void browser.storage.local.set({ [K_TAB]: tab });
        body.scrollTop = 0;
        draw();
        input.focus();
      });
    }
    input.addEventListener('input', draw);
    this.redraw = draw;
    draw();
    input.focus();
    document.addEventListener('pointerdown', this.onOutside, true);
    document.addEventListener('keydown', this.onKey, true);
  }

  private renderGrid(body: HTMLElement, tab: Tab, q: string, recent: string[]): void {
    const { emotes, bttv } = this.getData();
    body.replaceChildren();
    const note = (text: string, error = false) => {
      const div = document.createElement('div');
      div.className = error ? 'note err' : 'note';
      div.textContent = text;
      body.append(div);
    };
    const empty = (text: string) => {
      const div = document.createElement('div');
      div.className = 'empty';
      div.textContent = text;
      body.append(div);
    };
    const section = (title: string, codes: string[]) => {
      if (!codes.length) return;
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = title;
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const code of codes) {
        const e = emotes.get(code);
        if (!e) continue;
        const b = document.createElement('button');
        b.title = code;
        const img = document.createElement('img');
        img.src = e.src;
        if (e.srcset) img.srcset = e.srcset;
        img.alt = code;
        img.loading = 'lazy';
        b.append(img);
        b.addEventListener('click', () => {
          void insertIntoChat(this.adapter, code).then((ok) => {
            if (ok) void pushRecent(tab, code);
          });
          this.close();
        });
        grid.append(b);
      }
      body.append(label, grid);
    };
    // Код, который есть и в Owl Smile, и в BetterTTV, в чате станет смайлом Owl Smile — во вкладке BetterTTV его нет
    const inTab = (code: string) => {
      const e = emotes.get(code);
      return e !== undefined && Boolean(e.bttv) === (tab === 'bttv');
    };
    const byName = (a: string, b: string) => a.localeCompare(b);
    const found = (codes: string[]) => codes.filter((c) => c.toLowerCase().includes(q));

    if (tab === 'owl') {
      const all = [...emotes.keys()].filter(inTab).sort(byName);
      if (q) {
        section('Найдено', found(all));
      } else {
        section('Недавние', recent.filter(inTab));
        section('Все смайлы', all);
      }
      if (!body.childElementCount) empty(all.length ? 'Ничего не найдено' : 'Смайлов пока нет — нажмите «+», чтобы загрузить');
      return;
    }

    const ch = bttv.channel;
    const channelCodes = ch ? [...ch.codes].sort(byName) : [];
    const globalCodes = [...bttv.global].sort(byName);
    if (q) {
      section('Найдено', found([...channelCodes, ...globalCodes]));
      if (!body.childElementCount) empty('Ничего не найдено');
      return;
    }
    section('Недавние', recent.filter(inTab));
    if (!ch) {
      if (this.adapter.platform !== 'twitch') {
        note('Смайлы Twitch-канала не показаны: канал не указан. Укажите его в окне расширения — значок 🦉 на панели браузера.');
      }
    } else if (ch.state === 'loading') {
      note(`Загрузка смайлов канала ${ch.name}…`);
    } else if (ch.state === 'error') {
      note(`Смайлы канала ${ch.name} не загрузились: ${ch.error ?? 'ошибка'}`, true);
    } else if (!channelCodes.length) {
      note(`У канала ${ch.name} нет смайлов BetterTTV`);
    } else {
      section(`Канал ${ch.name}`, channelCodes);
    }
    if (globalCodes.length) section('Глобальные', globalCodes);
    else note('Глобальные смайлы BetterTTV ещё не загружены — нужен интернет.');
  }
}

/**
 * Автодополнение кода смайла по Tab (повторный Tab — следующий вариант).
 * Срабатывает, только если есть подходящие смайлы; иначе Tab обрабатывает сама площадка.
 */
export function installTabCompletion(adapter: ChatAdapter, getData: () => RenderData): () => void {
  let cycle: { options: string[]; i: number; inserted: string; lead: boolean } | null = null;

  const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.altKey) {
        if (e.key !== 'Shift') cycle = null;
        return;
      }
      const input = adapter.getChatInput();
      if (!input || !input.contains(e.target as Node)) return;
      // Слово — как и раньше, всё до пробела: «@ник» и «:смайл» дополняет сама площадка, их не трогаем.
      // Но текст считаем от последнего чипа: в ответе слово может стоять вплотную к чипу с ником.
      const { before, chip } = typedBeforeCaret(input);
      const word = /(\S+)$/.exec(before)?.[1] ?? '';
      // Слово вплотную к чипу — перед кодом нужен пробел, иначе смайл не распознается
      const glued = chip && word.length > 0 && word.length === before.length;

      let options: string[];
      let i: number;
      let replaceLen: number;
      let lead = glued;
      if (cycle && before.endsWith(cycle.inserted)) {
        // Повторный Tab сразу после вставки — следующий вариант вместо предыдущего.
        options = cycle.options;
        i = (cycle.i + 1) % options.length;
        replaceLen = cycle.inserted.length;
        lead = cycle.lead;
      } else {
        if (word.length < 2) return;
        const p = word.toLowerCase();
        options = [...getData().emotes.keys()]
          .filter((c) => c.toLowerCase().startsWith(p))
          .sort((a, b) => a.length - b.length || a.localeCompare(b));
        if (!options.length) return;
        i = 0;
        replaceLen = word.length;
      }

      e.preventDefault();
      e.stopImmediatePropagation();
      // Не выделяем слово (редактор площадки может не заметить выделение), а стираем его «Backspace'ами».
      const inserted = `${lead ? ' ' : ''}${options[i]!} `;
      editBeforeCaret(input, replaceLen, inserted);
      cycle = { options, i, inserted, lead };
  };
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}
