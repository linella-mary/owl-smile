import { useEffect, useState } from 'preact/hooks';
import { getWriteRepo } from '../../git/browser-repo';
import { clearKey, getKey, setKey } from '../../shared/key';

/** Ключ доступа: null — ещё загружается, '' — не введён. */
export function useKey(): [string | null, (k: string) => Promise<void>, () => Promise<void>] {
  const [key, setState] = useState<string | null>(null);
  useEffect(() => {
    void getKey().then(setState);
  }, []);
  return [
    key,
    async (k) => {
      await setKey(k);
      setState(k.trim());
    },
    async () => {
      await clearKey();
      setState('');
    },
  ];
}

export function KeyForm({ onSave }: { onSave: (k: string) => Promise<void> }) {
  const [value, setValue] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const k = value.trim();
    if (!k) return;
    setChecking(true);
    setError('');
    try {
      const ok = await (await getWriteRepo(k)).checkWriteAccess();
      if (ok) await onSave(k);
      else setError('Ключ не подошёл. Проверьте, что скопировали его целиком.');
    } catch (e) {
      setError(`Не удалось проверить ключ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <section class="card stack key-form">
      <h2>🔑 Ключ доступа</h2>
      <p class="muted">
        Смайлы в чате работают и без ключа. Чтобы загружать свои смайлы, иконки и эффекты,
        вставьте ключ, который вам прислал владелец Owl Smile. Вводить его нужно один раз.
      </p>
      <div class="row">
        <input
          class="grow"
          type="password"
          autoComplete="off"
          placeholder="Ключ доступа"
          value={value}
          onInput={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        <button disabled={!value.trim() || checking} onClick={() => void submit()}>
          {checking ? 'Проверяю…' : 'Сохранить'}
        </button>
      </div>
      {error && <div class="err small">{error}</div>}
    </section>
  );
}
