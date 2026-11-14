import type { Platform } from '../shared/ids';
import type { Settings } from '../shared/settings';

const CLASSES = ['owl-ts', 'owl-zebra', 'owl-sep', 'owl-font', 'owl-lh', 'owl-no-paint-anim'];
const VARS = ['--owl-emote-h', '--owl-badge-size', '--owl-font-size', '--owl-line-height', '--owl-hl-color'];

/**
 * Вид чата по личным настройкам: CSS-переменные и классы на корневом элементе
 * (<html> на площадке, контейнер предпросмотра на странице настроек). Правила — в style.css.
 * Выключенный Owl Smile (enabled: false) — всё снимается.
 */
export function applySettings(root: HTMLElement, s: Settings | null, platform: Platform = 'twitch'): void {
  root.classList.remove(...CLASSES);
  for (const v of VARS) root.style.removeProperty(v);
  if (!s || !s.enabled || !s.platforms[platform]) return;

  const vk = platform === 'vk';
  root.style.setProperty('--owl-emote-h', `${vk ? s.emoteSizeVk : s.emoteSize}px`);
  root.style.setProperty('--owl-badge-size', `${vk ? s.badgeSizeVk : s.badgeSize}px`);
  root.style.setProperty('--owl-hl-color', s.highlightColor);
  if (s.fontSize > 0) {
    root.classList.add('owl-font');
    root.style.setProperty('--owl-font-size', `${s.fontSize}px`);
  }
  if (s.lineSpacing > 0) {
    root.classList.add('owl-lh');
    root.style.setProperty('--owl-line-height', String(s.lineSpacing));
  }
  if (s.timestamps) root.classList.add('owl-ts');
  if (s.zebra) root.classList.add('owl-zebra');
  if (s.separators) root.classList.add('owl-sep');
  if (!s.paintAnimation) root.classList.add('owl-no-paint-anim');
}
