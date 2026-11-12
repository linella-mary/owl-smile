import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { Changes, Snapshot } from '../../git/repo';
import { getWriteRepo } from '../../git/browser-repo';
import { K_INDEX, getImages, getIndex, type LocalIndex } from '../../shared/cache';
import { requestSync } from '../../shared/messages';
import { ConflictError } from '../../git/repo';
import { UserError } from '../ops';

/** Данные из локального кэша + картинки (oid → data URL). */
export interface CacheView {
  index: LocalIndex | null;
  images: Record<string, string>;
}

export function useCache(): CacheView {
  const [view, setView] = useState<CacheView>({ index: null, images: {} });
  useEffect(() => {
    const load = async () => {
      const index = await getIndex();
      const oids = index ? [...Object.values(index.emotes).map((e) => e.img), ...Object.values(index.badges).map((b) => b.img)] : [];
      setView({ index, images: await getImages([...new Set(oids)]) });
    };
    void load();
    const onChange = (ch: Record<string, unknown>) => {
      if (K_INDEX in ch) void load();
    };
    browser.storage.local.onChanged.addListener(onChange);
    return () => browser.storage.local.onChanged.removeListener(onChange);
  }, []);
  return view;
}

const K_SETTINGS = 'owl:settings';
export interface Settings {
  author: string;
}

export function useSettings(): [Settings, (s: Settings) => void] {
  const [s, set] = useState<Settings>({ author: '' });
  useEffect(() => {
    void browser.storage.local.get(K_SETTINGS).then((r) => r[K_SETTINGS] && set(r[K_SETTINGS] as Settings));
  }, []);
  return [s, (next) => {
    set(next);
    void browser.storage.local.set({ [K_SETTINGS]: next });
  }];
}

export interface RunState {
  busy: boolean;
  message: { kind: 'ok' | 'err' | 'info'; text: string } | null;
}

export interface Runner extends RunState {
  /** Применить изменение к репозиторию и синхронизировать. Возвращает true при успехе. */
  run(title: string, mutation: (snap: Snapshot) => Changes): Promise<boolean>;
}

export const RunnerContext = createContext<Runner | null>(null);
export const useRunner = () => useContext(RunnerContext)!;

export function useRunnerState(author: string): Runner {
  const [state, setState] = useState<RunState>({ busy: false, message: null });
  return useMemo(
    () => ({
      ...state,
      async run(title, mutation) {
        if (!author.trim()) {
          setState({ busy: false, message: { kind: 'err', text: 'Сначала укажите свой ник вверху страницы' } });
          return false;
        }
        setState({ busy: true, message: { kind: 'info', text: `${title}…` } });
        try {
          await (await getWriteRepo()).commitAndPush(mutation, `${title} (${author})`, author.trim());
          setState({ busy: true, message: { kind: 'info', text: 'Сохранено, обновляю локальную базу…' } });
          await requestSync(true);
          setState({ busy: false, message: { kind: 'ok', text: `Готово: ${title}` } });
          return true;
        } catch (e) {
          const text =
            e instanceof UserError ? e.message
            : e instanceof ConflictError ? 'Слишком много одновременных изменений, попробуйте ещё раз'
            : `Ошибка: ${e instanceof Error ? e.message : String(e)}`;
          setState({ busy: false, message: { kind: 'err', text } });
          return false;
        }
      },
    }),
    [state, author],
  );
}

/** Зона перетаскивания файла + выбор через диалог. */
export function DropZone(props: { onFile: (f: File) => void; preview?: string | null; hint: ComponentChildren }) {
  const [over, setOver] = useState(false);
  return (
    <label
      class={`drop ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer?.files[0];
        if (f) props.onFile(f);
      }}
    >
      <input
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) props.onFile(f);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />
      {props.preview ? <img src={props.preview} alt="" /> : <span class="muted">{props.hint}</span>}
    </label>
  );
}

export function StatusLine() {
  const { message } = useRunner();
  if (!message) return null;
  return <div class={`status ${message.kind}`}>{message.text}</div>;
}
