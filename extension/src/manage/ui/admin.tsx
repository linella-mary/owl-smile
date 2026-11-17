import { useEffect, useState } from 'preact/hooks';
import { isAdminKey, isAdminNick } from '../../shared/admin';
import { clearAdminKey, getAdminKey, setAdminKey } from '../../shared/key';

/** Вошёл ли админ: null — ещё проверяется. Ключ сверяется с отпечатком из сборки при каждом открытии. */
export function useAdmin(): [boolean | null, (key: string) => Promise<void>, () => Promise<void>] {
  const [admin, setAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    void getAdminKey().then(isAdminKey).then(setAdmin, () => setAdmin(false));
  }, []);
  return [
    admin,
    async (key) => {
      await setAdminKey(key);
      setAdmin(true);
    },
    async () => {
      await clearAdminKey();
      setAdmin(false);
    },
  ];
}

/** Вход админа: ник и личный ключ. При успехе ник становится подписью к изменениям. */
export function AdminForm({ onLogin, onCancel }: { onLogin: (nick: string, key: string) => Promise<void>; onCancel: () => void }) {
  const [nick, setNick] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!isAdminNick(nick) || !(await isAdminKey(key))) {
      setError('Ник или ключ админа не подошли');
      return;
    }
    await onLogin(nick.trim(), key);
  };

  return (
    <section class="card stack key-form">
      <h2>Вход админа</h2>
      <div class="row">
        <input placeholder="Ник админа" autoComplete="off" value={nick} onInput={(e) => setNick(e.currentTarget.value)} />
        <input class="grow" type="password" autoComplete="off" placeholder="Ключ админа" value={key}
          onInput={(e) => setKey(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
        <button disabled={!nick.trim() || !key.trim()} onClick={() => void submit()}>Войти</button>
        <button class="ghost" onClick={onCancel}>Отмена</button>
      </div>
      {error && <div class="err small">{error}</div>}
    </section>
  );
}
