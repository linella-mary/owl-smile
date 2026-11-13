import { browser } from 'wxt/browser';
import type { ChatAdapter } from '../platforms/types';
import type { OwlMessage } from '../shared/messages';
import type { RenderData } from './renderer';

const BTN_ID = 'owl-picker-btn';
const K_RECENT = 'owl:recent';
const MAX_RECENT = 16;

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

/**
 * Последний текстовый узел поля ввода, который можно редактировать: не внутри чипа упоминания или
 * цитаты ответа (contenteditable="false"). Slate (Twitch) понимает каретку только внутри своих
 * текстовых узлов — точку «в конце корня редактора» он сопоставить не может, и вставка ломается.
 */
export function lastEditableText(input: HTMLElement): Text | null {
  const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const locked = n.parentElement?.closest('[contenteditable="false"]');
    if (locked && input.contains(locked)) continue;
    last = n as Text;
  }
  return last;
}

/** Каретка — в конец сообщения (в конец последнего редактируемого текста). */
export function caretToEnd(input: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  const text = lastEditableText(input);
  if (text) r.setStart(text, text.data.length);
  else {
    r.selectNodeContents(input);
    r.collapse(false);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/**
 * Вставка кода смайла из окна смайлов — всегда в конец сообщения. В режиме ответа в поле ввода есть
 * чип с ником или цитата, и каретка могла оказаться в них или за пределами текста — код портил ответ.
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

async function getRecent(): Promise<string[]> {
  return ((await browser.storage.local.get(K_RECENT))[K_RECENT] as string[] | undefined) ?? [];
}
async function pushRecent(code: string): Promise<void> {
  const list = [code, ...(await getRecent()).filter((c) => c !== code)].slice(0, MAX_RECENT);
  await browser.storage.local.set({ [K_RECENT]: list });
}

const PANEL_CSS = `
:host { all: initial; }
.panel {
  position: fixed; z-index: 2147483000; width: 320px; max-height: 360px; display: flex; flex-direction: column;
  background: #18181b; color: #efeff1; border: 1px solid #3a3a3d; border-radius: 8px; box-shadow: 0 8px 24px #000a;
  font: 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif;
}
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
`;

/** Кнопка смайлов возле поля ввода + всплывающая сетка (Shadow DOM, стили площадки не влияют). */
export class EmotePicker {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;

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
    Object.assign(btn.style, {
      background: 'none', border: '0', cursor: 'pointer', fontSize: '18px', padding: '0 6px',
      height: '30px', borderRadius: '4px', lineHeight: '30px',
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

  close(): void {
    this.host?.remove();
    this.host = this.root = null;
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
    const recent = await getRecent();
    this.host = document.createElement('div');
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `<div class="head"><input type="search" placeholder="Поиск смайла"><button class="add" title="Загрузить свой смайл">+</button></div><div class="body"></div>`;
    this.root.append(style, panel);
    document.body.append(this.host);

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
    panel.querySelector('.add')!.addEventListener('click', () => {
      void browser.runtime.sendMessage({ type: 'owl:open-manage' } satisfies OwlMessage);
      this.close();
    });
    const draw = () => this.renderGrid(body, input.value.trim().toLowerCase(), recent);
    input.addEventListener('input', draw);
    draw();
    input.focus();
    document.addEventListener('pointerdown', this.onOutside, true);
    document.addEventListener('keydown', this.onKey, true);
  }

  private renderGrid(body: HTMLElement, q: string, recent: string[]): void {
    const { emotes } = this.getData();
    body.replaceChildren();
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
        img.alt = code;
        img.loading = 'lazy';
        b.append(img);
        b.addEventListener('click', () => {
          void insertIntoChat(this.adapter, code).then((ok) => {
            if (ok) void pushRecent(code);
          });
          this.close();
        });
        grid.append(b);
      }
      body.append(label, grid);
    };
    const all = [...emotes.keys()].sort((a, b) => a.localeCompare(b));
    if (q) {
      section('Найдено', all.filter((c) => c.toLowerCase().includes(q)));
    } else {
      section('Недавние', recent.filter((c) => emotes.has(c)));
      section('Все смайлы', all);
    }
    if (!body.childElementCount) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = emotes.size ? 'Ничего не найдено' : 'Смайлов пока нет — нажмите «+», чтобы загрузить';
      body.append(empty);
    }
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
      const before = textBeforeCaret(input);
      // Код смайла — только латиница, цифры и «_». Так «@ник,Cat» в ответе дополняется по «Cat»
      const word = /([A-Za-z0-9_]+)$/.exec(before)?.[1] ?? '';
      // Слово приклеено к нику или знаку — перед кодом нужен пробел, иначе смайл не распознается
      const glued = before.length > word.length && !/\s/.test(before[before.length - word.length - 1]!);

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
