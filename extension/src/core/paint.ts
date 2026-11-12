import { HEX_COLOR_RE, PAINT_PRESETS } from '../shared/ids';
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
