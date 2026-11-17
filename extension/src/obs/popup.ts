/**
 * Окна, открытые из дока OBS (вход VK и Twitch, ссылки из чата). obs-browser в начале загрузки каждой
 * страницы подменяет window.close пустышкой — и в доке, и во всплывающих окнах. Окно входа после
 * успеха зовёт close(), ничего не происходит, и оно висит белым. Здесь close возвращается окнам,
 * у которых есть opener; сам док (opener === null) закрыть по-прежнему нельзя.
 */

/** Сколько ждать, прежде чем закрыть пустую страницу сайта чата (конец входа). */
export const BLANK_CLOSE_MS = 3000;

function onChatSite(host: string): boolean {
  return ['twitch.tv', 'vkvideo.ru'].some((d) => host === d || host.endsWith('.' + d));
}

function isBlank(): boolean {
  const body = document.body;
  if (!body) return true;
  if (body.innerText.trim()) return false;
  return !body.querySelector('img, video, canvas, svg, input, button, iframe:not([data-owl])');
}

/** Настоящий close: берётся из свежего окна (iframe) и вызывается для своего. */
function realClose(): void {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.dataset.owl = 'close';
  document.documentElement.append(frame);
  try {
    frame.contentWindow?.close.call(window);
  } finally {
    frame.remove();
  }
}

export function fixPopupClose(): void {
  const w = window as unknown as { __owlPopupFixed?: boolean };
  if (!window.opener || w.__owlPopupFixed) return;
  w.__owlPopupFixed = true;
  window.close = realClose;
  // Страница вернулась на сайт чата и осталась пустой: она уже вызвала пустышку close до нас
  if (onChatSite(location.hostname)) {
    setTimeout(() => {
      if (isBlank()) realClose();
    }, BLANK_CLOSE_MS);
  }
}
