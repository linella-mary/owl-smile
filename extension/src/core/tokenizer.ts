export type Token = { type: 'text'; value: string } | { type: 'emote'; code: string };

/**
 * Разбивает текст на куски: обычный текст и смайлы.
 * Смайлом считается только слово целиком (между пробельными символами), как в 7TV.
 * Соседние текстовые куски склеиваются. Если смайлов нет — возвращает null.
 */
export function tokenize(text: string, has: (code: string) => boolean): Token[] | null {
  const parts = text.split(/(\s+)/);
  const out: Token[] = [];
  let found = false;
  let buf = '';
  for (const part of parts) {
    if (part && !/^\s/.test(part) && has(part)) {
      if (buf) out.push({ type: 'text', value: buf });
      buf = '';
      out.push({ type: 'emote', code: part });
      found = true;
    } else {
      buf += part;
    }
  }
  if (!found) return null;
  if (buf) out.push({ type: 'text', value: buf });
  return out;
}
