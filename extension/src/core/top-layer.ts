/**
 * Окна Owl Smile (смайлы, подсказка, карточка профиля) — в «верхнем слое» браузера (Popover API).
 *
 * Зачем: окно смайлов на VK Live вставляется внутрь блока ввода (иначе VK считает клик по окну
 * «кликом мимо» и сбрасывает ответ), а блок ввода — свой слой с z-index 10. Плеер с бо́льшим
 * z-index перекрывал окно, какой z-index ни ставь самому окну (жалоба 14.11.2026).
 * Элемент в верхнем слое рисуется поверх всего на странице, в том числе полноэкранного плеера,
 * и не зависит от transform/filter предков, но остаётся в DOM там, куда его вставили, — для VK
 * клик по окну по-прежнему «внутри блока ввода».
 */
export const supportsTopLayer = (): boolean =>
  typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';

/** Стили [popover] по умолчанию (рамка, отступы, центрирование) — убираем: окно позиционируется само. */
const HOST_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  inset: '0 auto auto 0',
  width: '0',
  height: '0',
  margin: '0',
  padding: '0',
  border: '0',
  background: 'transparent',
  overflow: 'visible',
  color: 'inherit',
};

/**
 * Вставляет host в parent и поднимает в верхний слой. Внутри host окно позиционируется
 * через position: fixed относительно окна браузера.
 */
export function mountOnTop(host: HTMLElement, parent: Element): void {
  if (supportsTopLayer()) {
    host.setAttribute('popover', 'manual');
    Object.assign(host.style, HOST_STYLE);
  }
  parent.append(host);
  if (supportsTopLayer()) {
    try {
      host.showPopover();
    } catch {
      // Уже показан или не подключён — останется обычным элементом с z-index
    }
  }
}

