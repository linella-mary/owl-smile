/**
 * Неподвижный кадр анимированного смайла (для режимов «при наведении» и «не двигаются»).
 * Рисуем картинку в canvas — получается один кадр — и кэшируем как data: URL.
 * Смайлы Owl Smile — data: URL, canvas с ними не «портится». Смайлы BetterTTV грузим с crossOrigin:
 * если CDN не разрешит — кадра не будет, смайл останется как есть.
 */
const stills = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();
/** Кадры живут в памяти вкладки — не больше стольких (старые вытесняются). */
const MAX_STILLS = 200;

function remember(src: string, url: string | null): void {
  stills.delete(src);
  stills.set(src, url);
  if (stills.size > MAX_STILLS) stills.delete(stills.keys().next().value!);
}

export function getStill(src: string): string | null | undefined {
  return stills.get(src);
}

export function makeStill(src: string): Promise<string | null> {
  if (stills.has(src)) return Promise.resolve(stills.get(src)!);
  let p = pending.get(src);
  if (!p) {
    p = new Promise<string | null>((resolve) => {
      const img = new Image();
      if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || 1;
          c.height = img.naturalHeight || 1;
          c.getContext('2d')!.drawImage(img, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    }).then((url) => {
      remember(src, url);
      pending.delete(src);
      return url;
    });
    pending.set(src, p);
  }
  return p;
}

/** Показать на картинке смайла неподвижный кадр (если он уже есть или когда будет готов). */
export function freeze(img: HTMLImageElement): void {
  const src = img.dataset.owlAnim;
  if (!src) return;
  const still = getStill(src);
  if (still) {
    img.removeAttribute('srcset');
    img.src = still;
    return;
  }
  if (still === null) return; // кадр получить нельзя
  void makeStill(src).then((url) => {
    if (url && img.isConnected && img.dataset.owlAnim === src && !img.matches(':hover')) {
      img.removeAttribute('srcset');
      img.src = url;
    }
  });
}

/** Вернуть анимацию. */
export function unfreeze(img: HTMLImageElement): void {
  const src = img.dataset.owlAnim;
  if (!src || img.src === src) return;
  img.src = src;
  if (img.dataset.owlSrcset) img.srcset = img.dataset.owlSrcset;
}
