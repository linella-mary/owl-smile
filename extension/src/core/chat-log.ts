/**
 * Сообщения зрителей в этом чате — для профиля («Сообщений в этом чате: N» и последние 5).
 * Только в памяти вкладки: ничего не сохраняется и никуда не отправляется.
 */
export interface LogEntry {
  /** Время прихода (если сообщение пришло при открытом чате). */
  at?: number;
  text: string;
}

interface AuthorLog {
  count: number;
  last: LogEntry[];
}

export const LOG_LAST = 5;
const MAX_AUTHORS = 500;
const MAX_TEXT = 200;

export class ChatLog {
  private readonly byAuthor = new Map<string, AuthorLog>();

  /** key — "twitch:login" / "vk:nick". */
  add(key: string, text: string, at?: number): void {
    const t = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    let log = this.byAuthor.get(key);
    if (log) this.byAuthor.delete(key); // в конец — недавно писавший
    else log = { count: 0, last: [] };
    log.count++;
    if (t) log.last = [...log.last, { at, text: t }].slice(-LOG_LAST);
    this.byAuthor.set(key, log);
    if (this.byAuthor.size > MAX_AUTHORS) this.byAuthor.delete(this.byAuthor.keys().next().value!);
  }

  get(key: string): { count: number; last: LogEntry[] } {
    const log = this.byAuthor.get(key);
    return log ? { count: log.count, last: [...log.last] } : { count: 0, last: [] };
  }

  clear(): void {
    this.byAuthor.clear();
  }
}
