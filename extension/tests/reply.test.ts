// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { caretToEnd, endPoint, typedBeforeCaret } from '../src/core/picker';
import { ChatRenderer, emptyData, type RenderData } from '../src/core/renderer';
import { vkliveAdapter } from '../src/platforms/vklive';

/**
 * Ответы (reply). Разметка VK Live снята с живого чата 13.11.2026: цитата родительского сообщения —
 * [data-role="messageParentMessage"] со своим автором и своим [data-role="markup"] (однострочный).
 */
const VK_REPLY = `
<div class="ChatMessage_root_UHMEJ" data-role="messageContainer" data-message-id="1">
  <div class="ChatMessageParentMessage_parentMessage_K1haW" data-role="messageParentMessage">
    <span class="ChatMessageParentMessage_parentMessageAuthor_ZRVxt">Леся:</span>
    <div class="ChatMessageParentMessage_parentMessageTooltipRoot_H117C" title="смотри CatJam">
      <span class="BlockRenderer_markup_Wtipg BlockRenderer_textEllipsis_PIsNj" data-role="markup">смотри CatJam</span>
    </div>
  </div>
  <div class="ChatMessage_message_r1jzC"><div data-role="messageMainContent">
    <div class="ChatMessageAuthorPanel_author_qc2nK" data-role="messageAuthor">
      <span class="ChatMessageAuthorPanel_name_w3ZOm">ju1iana:</span>
    </div>
    <span class="BlockRenderer_markup_Wtipg" data-role="markup">ответ CatJam</span>
  </div></div>
</div>`;

function data(): RenderData {
  const d = emptyData();
  d.version = 'v1';
  d.emotes.set('CatJam', { src: 'data:image/webp;base64,AA==', w: 28, h: 28 });
  d.badges.set('owl', { src: 'data:image/webp;base64,BB==', title: 'Сова' });
  d.users['vk:ju1iana'] = { badges: ['owl'] };
  return d;
}

describe('VK Live: ответ на сообщение', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="chat">${VK_REPLY}</div>`;
  });

  it('смайлы и в ответе, и в цитате; иконки — автору ответа, а не цитаты', () => {
    new ChatRenderer(vkliveAdapter, data()).processTree(document);
    const msg = document.querySelector('[data-role="messageContainer"]')!;
    expect(msg.querySelectorAll('[data-role="messageMainContent"] img.owl-emote')).toHaveLength(1);
    expect(msg.querySelectorAll('[data-role="messageParentMessage"] img.owl-emote')).toHaveLength(1);
    const badges = msg.querySelector('.owl-badges')!;
    expect(badges.closest('[data-role="messageAuthor"]')).not.toBeNull();
  });

  it('смайл внутри ссылки на всё сообщение всё равно показывается', () => {
    document.body.innerHTML = `<a href="#jump" id="wrap">${VK_REPLY}</a>`;
    new ChatRenderer(vkliveAdapter, data()).processTree(document);
    expect(document.querySelectorAll('img.owl-emote')).toHaveLength(2);
  });
});

/** Каретка в конец текстового узла с данным текстом. */
function caretAfter(root: HTMLElement, text: string): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n as Text).data !== text) continue;
    const r = document.createRange();
    r.setStart(n, text.length);
    r.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    return;
  }
  throw new Error('нет текста: ' + text);
}

describe('Вставка из окна смайлов: каретка в конец сообщения', () => {
  const editor = (html: string) => {
    document.body.innerHTML = `<div id="ed" contenteditable="true">${html}</div>`;
    return document.getElementById('ed')!;
  };

  it('обычный текст — в конец текста', () => {
    const ed = editor('<p>привет</p>');
    const [node, offset] = endPoint(ed);
    expect((node as Text).data).toBe('привет');
    expect(offset).toBe(6);
  });

  it('ответ: чип с ником, потом текст — в конец текста', () => {
    const ed = editor('<p><span contenteditable="false">@Леся</span> привет</p>');
    caretToEnd(ed);
    const sel = window.getSelection()!;
    expect((sel.anchorNode as Text).data).toBe(' привет');
    expect(sel.anchorOffset).toBe(7);
  });

  it('сообщение заканчивается чипом — сразу после чипа, а не перед ним', () => {
    const ed = editor('<p>привет <span contenteditable="false">@Леся</span></p>');
    const [node, offset] = endPoint(ed);
    expect(node).toBe(ed.querySelector('p'));
    expect(offset).toBe(2);
  });

  it('пустая строка редактора (<br>) — внутри строки, перед <br>', () => {
    const ed = editor('<p><br></p>');
    const [node, offset] = endPoint(ed);
    expect(node).toBe(ed.querySelector('p'));
    expect(offset).toBe(0);
  });

  it('пустой редактор Slate (Twitch): подсказка-чип и невидимый символ', () => {
    const ed = editor('<div><span><span contenteditable="false">Send a message</span><span data-slate-zero-width="n">﻿<br></span></span></div>');
    const [node, offset] = endPoint(ed);
    expect((node as Text).data).toBe('﻿');
    expect(offset).toBe(1);
  });

  it('совсем пустое поле', () => {
    const ed = editor('');
    expect(endPoint(ed)).toEqual([ed, 0]);
  });
});

describe('Tab-автодополнение: набранный текст считается от чипа', () => {
  const editor = (html: string) => {
    document.body.innerHTML = `<div id="ed" contenteditable="true">${html}</div>`;
    return document.getElementById('ed')!;
  };

  it('без чипов — весь текст до каретки (как раньше)', () => {
    const ed = editor('<p>hi @ow</p>');
    caretAfter(ed, 'hi @ow');
    expect(typedBeforeCaret(ed)).toEqual({ before: 'hi @ow', chip: false });
  });

  it('слово вплотную к чипу с ником — только слово', () => {
    const ed = editor('<p><span contenteditable="false">@Леся</span>Cat</p>');
    caretAfter(ed, 'Cat');
    expect(typedBeforeCaret(ed)).toEqual({ before: 'Cat', chip: true });
  });

  it('чип после каретки не считается', () => {
    const ed = editor('<p>Cat<span contenteditable="false">@Леся</span></p>');
    caretAfter(ed, 'Cat');
    expect(typedBeforeCaret(ed)).toEqual({ before: 'Cat', chip: false });
  });

  it('неразрывный пробел после чипа — обычный пробел', () => {
    const ed = editor('<p><span contenteditable="false">@Леся</span> Cat</p>');
    caretAfter(ed, ' Cat');
    expect(typedBeforeCaret(ed)).toEqual({ before: ' Cat', chip: true });
  });
});
