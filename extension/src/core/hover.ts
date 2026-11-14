import type { Settings } from '../shared/settings';
import { emoteCaption, type RenderData } from './renderer';
import { freeze, unfreeze } from './still';
import { mountOnTop } from './top-layer';

const TIP_CSS = `
:host { all: initial; }
.tip {
  position: fixed; z-index: 2147483001; pointer-events: none; display: flex; flex-direction: column; align-items: center; gap: 5px;
  background: #18181b; color: #efeff1; border: 1px solid #3a3a3d; border-radius: 8px; box-shadow: 0 6px 18px #000a;
  padding: 10px 12px; font: 12px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 260px; text-align: center;
}
img { height: 84px; max-width: 220px; object-fit: contain; }
.code { font-weight: 700; font-size: 14px; word-break: break-all; }
.src { font-size: 11px; font-weight: 600; border-radius: 4px; padding: 2px 7px; }
.src.owl { background: #9147ff33; color: #d2b8ff; border: 1px solid #9147ff88; }
.src.bttv { background: #d5003033; color: #ffb3c1; border: 1px solid #d5003088; }
.author { color: #adadb8; word-break: break-word; }
`;

/**
 * Наведение на смайл в чате: крупная подсказка (код, откуда смайл, кто загрузил)
 * и запуск анимации в режиме «при наведении». Возвращает функцию отключения.
 */
export function installHover(getSettings: () => Settings, getData: () => RenderData): () => void {
  let host: HTMLElement | null = null;
  let tip: HTMLElement | null = null;
  let current: HTMLImageElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;

  const hide = () => {
    clearTimeout(hideTimer);
    cancelAnimationFrame(frame);
    host?.remove();
    host = tip = null;
  };

  /** Над смайлом, а если сверху тесно — под ним. Смайл ушёл из DOM или с экрана — подсказку прячем. */
  const place = () => {
    if (!tip || !current) return;
    const r = current.getBoundingClientRect();
    if (!current.isConnected || r.bottom < 0 || r.top > window.innerHeight || (r.width === 0 && r.height === 0)) {
      leave(true);
      return;
    }
    const t = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(6, Math.min(window.innerWidth - t.width - 6, r.left + r.width / 2 - t.width / 2))}px`;
    tip.style.top = r.top - t.height - 8 >= 6 ? `${r.top - t.height - 8}px` : `${r.bottom + 8}px`;
  };

  const show = (img: HTMLImageElement) => {
    const e = getData().emotes.get(img.alt);
    if (!e) return;
    hide();
    host = document.createElement('div');
    host.className = 'owl-tip-host';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = TIP_CSS;
    tip = document.createElement('div');
    tip.className = 'tip';
    const big = document.createElement('img');
    // «Не двигаются» — и в подсказке неподвижный кадр
    const still = getSettings().animation === 'off' && img.dataset.owlAnim && img.src !== img.dataset.owlAnim;
    big.src = still ? img.src : e.src;
    if (e.srcset && !still) big.srcset = e.srcset;
    big.alt = '';
    // Код, откуда смайл (значок Owl Smile или BetterTTV), кто загрузил — только textContent
    const [codeText, sourceText, authorText] = emoteCaption(img.alt, e);
    const code = document.createElement('div');
    code.className = 'code';
    code.textContent = codeText;
    const src = document.createElement('div');
    src.className = e.bttv ? 'src bttv' : 'src owl';
    src.textContent = sourceText;
    tip.append(big, code, src);
    if (authorText) {
      const author = document.createElement('div');
      author.className = 'author';
      author.textContent = authorText;
      tip.append(author);
    }
    root.append(style, tip);
    mountOnTop(host, document.body);
    place();
    // Картинка в подсказке догрузилась — размер поменялся
    big.addEventListener('load', place);
  };

  /** Мышь ушла со смайла. now — сразу (смайл исчез), иначе с короткой задержкой: вернулась — остаёмся. */
  const leave = (now = false) => {
    clearTimeout(hideTimer);
    const done = () => {
      if (current && getSettings().animation === 'hover') freeze(current);
      current = null;
      hide();
    };
    if (now) done();
    else hideTimer = setTimeout(done, 100);
  };

  const onOver = (ev: MouseEvent) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('owl-emote')) return;
    if (img === current) {
      clearTimeout(hideTimer); // вернулись на тот же смайл
      return;
    }
    if (current) leave(true);
    current = img;
    const s = getSettings();
    if (s.animation === 'hover') unfreeze(img);
    if (s.hoverPreview) show(img);
  };
  const onOut = (ev: MouseEvent) => {
    if (ev.target !== current) return;
    if (ev.relatedTarget instanceof Node && current?.contains(ev.relatedTarget)) return;
    leave();
  };
  // Чат прокручивается (новые сообщения) — подсказка едет за смайлом, а не исчезает
  const onScroll = () => {
    if (!tip) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(place);
  };
  const onBlur = () => leave(true);

  document.addEventListener('mouseover', onOver, true);
  document.addEventListener('mouseout', onOut, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('blur', onBlur);
  return () => {
    document.removeEventListener('mouseover', onOver, true);
    document.removeEventListener('mouseout', onOut, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('blur', onBlur);
    hide();
  };
}
