/**
 * Замена `wxt/browser` для страниц в доках OBS: там нет API расширений.
 * Сборка OBS (vite.obs.config.ts) подставляет этот модуль вместо `wxt/browser`,
 * поэтому общий код (core/, shared/) работает без изменений.
 *
 * storage.local — в памяти; мелкие личные записи (недавние смайлы, вкладка окна, заметки)
 *   дублируются в localStorage страницы, база и картинки — нет (их присылает плагин).
 * storage.sync  — настройки, целиком в localStorage.
 * runtime.sendMessage — обрабатывает сам бандл (см. inject.ts).
 */

type Change = { oldValue?: unknown; newValue?: unknown };
type Listener = (changes: Record<string, Change>) => void;
type Keys = string | string[] | null | undefined;

class Area {
  private readonly mem = new Map<string, unknown>();
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly prefix: string,
    private readonly persist: (key: string) => boolean,
  ) {}

  private read(key: string): unknown {
    if (this.mem.has(key)) return this.mem.get(key);
    if (!this.persist(key)) return undefined;
    try {
      const raw = localStorage.getItem(this.prefix + key);
      if (raw === null) return undefined;
      const v: unknown = JSON.parse(raw);
      this.mem.set(key, v);
      return v;
    } catch {
      return undefined;
    }
  }

  private save(key: string, value: unknown): void {
    if (!this.persist(key)) return;
    try {
      if (value === undefined) localStorage.removeItem(this.prefix + key);
      else localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch {
      // localStorage недоступен или переполнен — остаётся в памяти до перезагрузки дока
    }
  }

  private emit(changes: Record<string, Change>): void {
    if (!Object.keys(changes).length) return;
    // Как в браузере: слушатели узнают об изменении после завершения set/remove
    queueMicrotask(() => {
      for (const l of this.listeners) l(changes);
    });
  }

  async get(keys?: Keys): Promise<Record<string, unknown>> {
    const list = keys == null ? [...this.mem.keys()] : typeof keys === 'string' ? [keys] : keys;
    const out: Record<string, unknown> = {};
    for (const k of list) {
      const v = this.read(k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    const changes: Record<string, Change> = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: this.read(k), newValue: v };
      this.mem.set(k, v);
      this.save(k, v);
    }
    this.emit(changes);
  }

  async remove(keys: string | string[]): Promise<void> {
    const changes: Record<string, Change> = {};
    for (const k of typeof keys === 'string' ? [keys] : keys) {
      const old = this.read(k);
      this.mem.delete(k);
      this.save(k, undefined);
      if (old !== undefined) changes[k] = { oldValue: old };
    }
    this.emit(changes);
  }

  readonly onChanged = {
    addListener: (l: Listener) => void this.listeners.add(l),
    removeListener: (l: Listener) => void this.listeners.delete(l),
    hasListener: (l: Listener) => this.listeners.has(l),
  };
}

/** База, картинки и списки BetterTTV приходят заново при каждой загрузке — в localStorage им не место. */
const persistLocal = (key: string) => key !== 'owl:index' && !key.startsWith('img:') && !key.startsWith('bttv:') && key !== 'owl:imgs';

type MessageHandler = (msg: unknown) => Promise<unknown> | unknown;
let onMessage: MessageHandler = () => undefined;

/** Кто отвечает на runtime.sendMessage (задаёт inject.ts). */
export function setMessageHandler(h: MessageHandler): void {
  onMessage = h;
}

export const browser = {
  storage: {
    local: new Area('owl-obs:l:', persistLocal),
    sync: new Area('owl-obs:s:', () => true),
  },
  runtime: {
    /** Непустой id: core/start.ts по нему понимает, что «расширение» живо. */
    id: 'owl-smile-obs',
    sendMessage: async (msg: unknown): Promise<unknown> => onMessage(msg),
    getURL: (path: string) => path,
    openOptionsPage: async () => undefined,
  },
};
