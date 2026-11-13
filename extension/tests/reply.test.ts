// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { caretToEnd, lastEditableText } from '../src/core/picker';
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

describe('Вставка из окна смайлов в режиме ответа', () => {
  it('каретка уходит в конец последнего редактируемого текста, мимо чипа с ником', () => {
    document.body.innerHTML = `
      <div id="ed" contenteditable="true"><p><span contenteditable="false" class="mention">@Леся</span><span>привет</span></p><p><span contenteditable="false">цитата</span></p></div>`;
    const ed = document.getElementById('ed')!;
    const last = lastEditableText(ed)!;
    expect(last.data).toBe('привет');
    caretToEnd(ed);
    const sel = window.getSelection()!;
    expect(sel.anchorNode).toBe(last);
    expect(sel.anchorOffset).toBe('привет'.length);
  });

  it('пустое поле: каретка в конце поля', () => {
    document.body.innerHTML = `<div id="ed" contenteditable="true"><span contenteditable="false">@Леся</span></div>`;
    const ed = document.getElementById('ed')!;
    expect(lastEditableText(ed)).toBeNull();
    caretToEnd(ed);
    expect(window.getSelection()!.anchorNode).toBe(ed);
  });
});
