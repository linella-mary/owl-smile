import type { Platform } from '../shared/ids';
import type { Settings } from '../shared/settings';

export interface Verdict {
  /** Сообщение скрыть (или свернуть — по filterMode). */
  hide: boolean;
  /** Почему скрыто — для подписи «скрыто: …». */
  reason?: 'user' | 'bot' | 'word';
  highlight: boolean;
}

const WORD_SPLIT = /[^\p{L}\p{N}_]+/u;

/** Слова текста в нижнем регистре (буквы, цифры, _), «@ник» → «ник». */
function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(WORD_SPLIT).filter(Boolean));
}

/**
 * Совпадение с элементом списка: одно слово — целым словом («ass» не найдётся в «class»),
 * фраза с пробелами или знаками — подстрокой.
 */
function matches(item: string, text: string, ws: Set<string>): boolean {
  const s = item.toLowerCase();
  return WORD_SPLIT.test(s) ? text.includes(s) : ws.has(s);
}

/**
 * Решает, что делать с сообщением по личным настройкам. Чистая функция: её же использует
 * предпросмотр на странице настроек.
 * `author` — ник в нижнем регистре (null — не определён), `text` — текст сообщения (с кодами смайлов).
 */
export function classifyMessage(text: string, author: string | null, s: Settings, platform: Platform): Verdict {
  const lower = text.toLowerCase();
  const ws = words(text);

  if (author) {
    if (s.hideUsers.includes(author)) return { hide: true, reason: 'user', highlight: false };
    if (s.hideBots && s.bots.includes(author)) return { hide: true, reason: 'bot', highlight: false };
  }
  if (s.hideWords.some((w) => matches(w, lower, ws))) return { hide: true, reason: 'word', highlight: false };

  const me = s.myNicks[platform];
  const highlight =
    (author !== null && s.highlightUsers.includes(author)) ||
    (s.highlightMentions && Boolean(me) && author !== me && matches(me, lower, ws)) ||
    s.highlightWords.some((w) => matches(w, lower, ws));
  return { hide: false, highlight };
}
