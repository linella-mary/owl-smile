import {
  HEX_COLOR_RE,
  PAINT_PRESETS,
  PLATE_ANIMS,
  PLATE_PATTERNS,
  PLATE_SHAPES,
  isValidEmoji,
  isValidPlateSymbols,
  splitEmoji,
  type NameplateKind,
  type PlateAnim,
  type PlatePattern,
  type PlateShape,
} from '../shared/ids';
import type { Paint } from '../shared/schema';

const CLASSES = ['owl-paint', ...PAINT_PRESETS.map((p) => `owl-paint--${p}`)];
const VARS = ['--owl-c1', '--owl-c2', '--owl-colors', '--owl-angle', '--owl-speed'];

/**
 * Применяет эффект ника. В стиль попадают только проверенные значения
 * (#RRGGBB, числа) через CSS-переменные — сырой CSS из данных не используется.
 */
export function applyPaint(el: HTMLElement, paint: Paint | null | undefined): void {
  clearPaint(el);
  if (!paint) return;
  const colors = paint.colors.filter((c) => HEX_COLOR_RE.test(c));
  if (!colors.length) return;
  const list = colors.length === 1 ? [colors[0]!, colors[0]!] : colors;
  el.classList.add('owl-paint', `owl-paint--${paint.preset}`);
  el.style.setProperty('--owl-c1', colors[0]!);
  el.style.setProperty('--owl-c2', colors[1] ?? colors[0]!);
  el.style.setProperty('--owl-colors', list.join(', '));
  el.style.setProperty('--owl-angle', `${paint.angle ?? 90}deg`);
  el.style.setProperty('--owl-speed', `${paint.speed ?? 3}s`);
}

export function clearPaint(el: HTMLElement): void {
  el.classList.remove(...CLASSES);
  for (const v of VARS) el.style.removeProperty(v);
}

// ——— Подложка под ник ———

/**
 * Подложка, готовая к показу. Все значения собраны здесь из проверенных данных: data: URL плиток
 * (собранные нами SVG или data:image из кэша), цвета #RRGGBB и числа — сырого CSS из данных нет.
 */
export interface PlateView {
  /** Значение background-image для ::before: url("data:…") и, возможно, градиент подкраски. */
  bg: string;
  /** Старая эмодзи-подложка (плитка повторяется по ширине). */
  emoji: boolean;
  opacity: number;
  title: string;
  /** Узор или символы: плитка, цвета, свечение, анимация, форма. */
  pattern?: {
    tileW: number;
    tileH: number;
    c1: string;
    c2?: string;
    /** Радиус свечения, px. */
    glow: number;
    anim: PlateAnim;
    speed: number;
    shape: PlateShape;
    fade: boolean;
  };
}

const DATA_IMAGE_RE = /^data:image\/(webp|gif|png|jpeg);base64,[A-Za-z0-9+/=]+$/;

/** SVG → data: URL без кавычек и скобок (безопасно внутри url("…")). */
function svgUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29')}`;
}

/** Узор из эмодзи (старый вид подложек): по клетке 24×24 на эмодзи. Эмодзи заранее проверены (isValidEmoji). */
export function emojiTile(emoji: string): string {
  const list = splitEmoji(emoji);
  const cells = list.map((e, i) => `<text x="${i * 24 + 12}" y="19" font-size="17" text-anchor="middle">${e}</text>`).join('');
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${list.length * 24}" height="24" viewBox="0 0 ${list.length * 24} 24">${cells}</svg>`);
}

/** Векторные узоры: [ширина плитки, высота, содержимое SVG с цветом c]. Высота 24 — как у строки чата. */
const PATTERNS: Record<PlatePattern, [number, number, (c: string) => string]> = {
  slash: [12, 24, (c) => `<path d="M-3 30L15-6" stroke="${c}" stroke-width="3.4"/>`],
  backslash: [12, 24, (c) => `<path d="M-3-6L15 30" stroke="${c}" stroke-width="3.4"/>`],
  dots: [8, 24, (c) => `<circle cx="4" cy="8" r="1.8" fill="${c}"/><circle cx="4" cy="16" r="1.8" fill="${c}"/>`],
  grid: [10, 12, (c) => `<path d="M0 .75H10M.75 0V12" stroke="${c}" stroke-width="1.5"/>`],
  lines: [4, 6, (c) => `<rect width="4" height="2.2" fill="${c}"/>`],
  zigzag: [12, 24, (c) => `<path d="M0 16L6 8L12 16" fill="none" stroke="${c}" stroke-width="2.8" stroke-linejoin="round"/>`],
  lightning: [20, 24, (c) => `<path d="M11.5 1L4 13.5H9.5L7.5 23L16 9.5H10.5L13 1Z" fill="${c}"/>`],
  waves: [24, 24, (c) => `<path d="M0 12Q6 5 12 12T24 12" fill="none" stroke="${c}" stroke-width="2.8"/>`],
  chevrons: [12, 24, (c) => `<path d="M3 6L9 12L3 18" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`],
  stars: [24, 24, (c) => `<path d="M12 4.5L14.1 9.6L19.6 10L15.4 13.5L16.7 18.9L12 16L7.3 18.9L8.6 13.5L4.4 10L9.9 9.6Z" fill="${c}"/>`],
  hearts: [24, 24, (c) => `<path d="M12 19C5 14 4 11 4 9A4 4 0 0 1 12 7.5A4 4 0 0 1 20 9C20 11 19 14 12 19Z" fill="${c}"/>`],
  sparkles: [24, 24, (c) => `<path d="M12 3Q13 11 21 12Q13 13 12 21Q11 13 3 12Q11 11 12 3Z" fill="${c}"/>`],
  diamonds: [16, 24, (c) => `<path d="M8 6L14 12L8 18L2 12Z" fill="${c}"/>`],
  cross: [16, 24, (c) => `<path d="M8 7V17M3 12H13" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`],
};

const svgOpen = (w: number, h: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
const SYMBOL_FONT = 'font-family="Segoe UI Symbol,DejaVu Sans,Noto Sans Symbols 2,sans-serif" font-weight="700" text-anchor="middle"';
/** Вариант начертания «текстом» (U+FE0E): знак рисуется одним цветом, а не цветным эмодзи. */
const TEXT_STYLE = String.fromCharCode(0xfe0e);
const mono = (ch: string) => (ch.charCodeAt(0) > 0x7e ? ch + TEXT_STYLE : ch);

/** Второй слой плитки: цвет, (у узоров) свой узор, шахматка. */
export interface TileAlt {
  color: string;
  pattern?: PlatePattern;
  checker?: boolean;
}

/**
 * Плитка узора или своих символов. Символы проверены isValidPlateSymbols (нет < > & " ').
 * alt — второй слой: чередуется с первым «1-2-1-2» вдоль ника или шахматкой в два ряда.
 */
export function patternTile(src: { pattern: PlatePattern } | { symbols: string }, color: string, alt?: TileAlt): { url: string; w: number; h: number } {
  const c1 = HEX_COLOR_RE.test(color) ? color : '#ffffff';
  const c2 = alt && HEX_COLOR_RE.test(alt.color) ? alt.color : null;
  const checker = Boolean(c2 && alt?.checker);

  if ('symbols' in src) {
    const chars = [...src.symbols];
    if (!checker) {
      // Один ряд; со вторым слоем — цвета через один: 1-2-1-2
      const cell = 14;
      const w = chars.length * cell;
      const cells = chars
        .map((ch, i) => (ch === ' ' ? '' : `<text x="${i * cell + cell / 2}" y="17" font-size="15" fill="${c2 && i % 2 ? c2 : c1}">${mono(ch)}</text>`))
        .join('');
      return { url: svgUrl(`${svgOpen(w, 24)}<g ${SYMBOL_FONT}>${cells}</g></svg>`), w, h: 24 };
    }
    // Шахматка: два ряда помельче, во втором цвета наоборот
    const cell = 10;
    const doubled = [...chars, ...chars];
    const w = doubled.length * cell;
    const row = (y: number, shift: number) =>
      doubled
        .map((ch, i) => (ch === ' ' ? '' : `<text x="${i * cell + cell / 2}" y="${y}" font-size="10" fill="${(i + shift) % 2 ? c2 : c1}">${mono(ch)}</text>`))
        .join('');
    return { url: svgUrl(`${svgOpen(w, 24)}<g ${SYMBOL_FONT}>${row(10, 0)}${row(22, 1)}</g></svg>`), w, h: 24 };
  }

  const [wa, ha, drawA] = PATTERNS[src.pattern];
  if (!c2) return { url: svgUrl(`${svgOpen(wa, ha)}${drawA(c1)}</svg>`), w: wa, h: ha };
  const [wb, hb, drawB] = PATTERNS[alt!.pattern ?? src.pattern];
  // Узор — SVG <pattern>: клетка заливается им, а он сам повторяется внутри клетки
  const def = (id: string, w: number, h: number, body: string, tf: string) =>
    `<pattern id="${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse" patternTransform="${tf}">${body}</pattern>`;
  if (!checker) {
    // 1-2-1-2: клетка первого слоя, за ней клетка второго (высота плитки — 24, как у строки чата)
    const w = wa + wb;
    const defs = def('a', wa, ha, drawA(c1), 'translate(0 0)') + def('b', wb, hb, drawB(c2), `translate(${wa} 0)`);
    return {
      url: svgUrl(`${svgOpen(w, 24)}<defs>${defs}</defs><rect width="${wa}" height="24" fill="url(#a)"/><rect x="${wa}" width="${wb}" height="24" fill="url(#b)"/></svg>`),
      w,
      h: 24,
    };
  }
  // Шахматка 2×2 из клеток 12×12: узоры уменьшены вдвое, во втором ряду слои наоборот
  const s = 12;
  const defs = def('a', wa, ha, drawA(c1), 'scale(.5)') + def('b', wb, hb, drawB(c2), 'scale(.5)');
  const cellRect = (x: number, y: number, id: string) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="url(#${id})"/>`;
  const body = cellRect(0, 0, 'a') + cellRect(s, 0, 'b') + cellRect(0, s, 'b') + cellRect(s, s, 'a');
  return { url: svgUrl(`${svgOpen(2 * s, 2 * s)}<defs>${defs}</defs>${body}</svg>`), w: 2 * s, h: 2 * s };
}

/** Данные подложки (из кэша или из формы) — то, что нужно для показа. */
export interface PlateSource {
  title: string;
  kind: NameplateKind;
  emoji?: string;
  opacity?: number;
  pattern?: PlatePattern;
  symbols?: string;
  colors?: string[];
  glow?: number;
  anim?: PlateAnim;
  speed?: number;
  shape?: PlateShape;
  fade?: boolean;
  alt?: TileAlt;
}

/** Из данных — в вид для отрисовки; null, если показывать нечего или данные подозрительные. */
export function plateView(p: PlateSource, imageSrc: string | undefined): PlateView | null {
  const clampOpacity = (d: number) => Math.min(1, Math.max(0.15, p.opacity ?? d));
  if (p.kind === 'pattern' || p.kind === 'symbols') {
    const c1 = p.colors?.[0];
    if (!c1 || !HEX_COLOR_RE.test(c1)) return null;
    const c2 = p.colors?.[1] && HEX_COLOR_RE.test(p.colors[1]) ? p.colors[1] : undefined;
    let tile: { url: string; w: number; h: number };
    if (p.kind === 'pattern') {
      if (!p.pattern || !PLATE_PATTERNS.includes(p.pattern)) return null;
      const alt = p.alt && (!p.alt.pattern || PLATE_PATTERNS.includes(p.alt.pattern)) ? p.alt : undefined;
      tile = patternTile({ pattern: p.pattern }, c1, alt);
    } else {
      if (!p.symbols || !isValidPlateSymbols(p.symbols)) return null;
      tile = patternTile({ symbols: p.symbols }, c1, p.alt ? { color: p.alt.color, checker: p.alt.checker } : undefined);
    }
    // Под узором — подкраска (c2) или, если её нет, лёгкая дымка цветом узора: так подложку видно
    // и при бледном цвете, и при малой непрозрачности (живой тест: полосы почти сливались с фоном)
    const bg = `url("${tile.url}")` + (c2 ? `, linear-gradient(90deg, ${c2}aa, ${c2}44)` : `, linear-gradient(90deg, ${c1}40, ${c1}26)`);
    return {
      bg,
      emoji: false,
      opacity: clampOpacity(0.75),
      title: p.title,
      pattern: {
        tileW: tile.w,
        tileH: tile.h,
        c1,
        c2,
        glow: Math.round(Math.min(1, Math.max(0, p.glow ?? 0)) * 8),
        anim: p.anim && PLATE_ANIMS.includes(p.anim) ? p.anim : 'none',
        speed: Math.min(20, Math.max(0.5, p.speed ?? 4)),
        shape: p.shape && PLATE_SHAPES.includes(p.shape) ? p.shape : 'fill',
        fade: Boolean(p.fade),
      },
    };
  }
  if (p.kind === 'emoji') {
    if (!p.emoji || !isValidEmoji(p.emoji)) return null;
    return { bg: `url("${emojiTile(p.emoji)}")`, emoji: true, opacity: clampOpacity(0.6), title: p.title };
  }
  if (!imageSrc || !DATA_IMAGE_RE.test(imageSrc)) return null;
  return { bg: `url("${imageSrc}")`, emoji: false, opacity: clampOpacity(0.6), title: p.title };
}

const PLATE_CLASSES = [
  'owl-plate', 'owl-plate--emoji', 'owl-plate--pattern', 'owl-plate--fade',
  ...PLATE_SHAPES.map((s) => `owl-plate--${s}`),
  ...PLATE_ANIMS.map((a) => `owl-plate--anim-${a}`),
];
const PLATE_VARS = [
  '--owl-plate', '--owl-plate-opacity', '--owl-plate-c1', '--owl-plate-c2', '--owl-plate-glow', '--owl-plate-speed', '--owl-plate-tile-w', '--owl-plate-tile-h',
];

/**
 * Подложка рисуется псевдоэлементами ::before (узор) и ::after (блик) ника (style.css) — в ник ничего
 * не вставляется: VK Live берёт ник из текста элемента. Родитель ника становится отдельным слоем
 * (owl-plate-ctx), чтобы подложка легла под текст ника — в том числе под градиентный текст эффекта.
 */
export function applyNameplate(el: HTMLElement, plate: PlateView | null): void {
  clearNameplate(el);
  if (!plate) return;
  el.classList.add('owl-plate');
  if (plate.emoji) el.classList.add('owl-plate--emoji');
  el.style.setProperty('--owl-plate', plate.bg);
  el.style.setProperty('--owl-plate-opacity', String(plate.opacity));
  const p = plate.pattern;
  if (p) {
    el.classList.add('owl-plate--pattern', `owl-plate--${p.shape}`, `owl-plate--anim-${p.anim}`);
    if (p.fade) el.classList.add('owl-plate--fade');
    el.style.setProperty('--owl-plate-c1', p.c1);
    el.style.setProperty('--owl-plate-c2', p.c2 ?? 'transparent');
    el.style.setProperty('--owl-plate-glow', `${p.glow}px`);
    el.style.setProperty('--owl-plate-speed', `${p.speed}s`);
    el.style.setProperty('--owl-plate-tile-w', `${p.tileW}px`);
    el.style.setProperty('--owl-plate-tile-h', `${p.tileH}px`);
  }
  el.parentElement?.classList.add('owl-plate-ctx');
}

export function clearNameplate(el: HTMLElement): void {
  if (!el.classList.contains('owl-plate')) return;
  el.classList.remove(...PLATE_CLASSES);
  for (const v of PLATE_VARS) el.style.removeProperty(v);
  el.parentElement?.classList.remove('owl-plate-ctx');
}
