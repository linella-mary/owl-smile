import { render } from 'preact';
import { useState } from 'preact/hooks';
import { adminEnabled, config, isConfigured } from '../../shared/config';
import { AdminForm, useAdmin } from '../../manage/ui/admin';
import { BadgesTab } from '../../manage/ui/badges';
import { RunnerContext, StatusLine, useCache, useRunnerState, useSettings } from '../../manage/ui/common';
import { EmotesTab } from '../../manage/ui/emotes';
import { NameplatesTab } from '../../manage/ui/nameplates';
import { KeyForm, useKey } from '../../manage/ui/key';
import { PaintsTab } from '../../manage/ui/paints';
import { UsersTab } from '../../manage/ui/users';

const TABS = { emotes: 'Смайлы', badges: 'Иконки', paints: 'Эффекты ников', nameplates: 'Подложки', users: 'Зрители' } as const;
type Tab = keyof typeof TABS;
/** Без входа админа — только смайлы: свои добавлять, удалять и переименовывать. */
const USER_TABS: Tab[] = ['emotes'];

function App() {
  const cache = useCache();
  const [settings, setSettings] = useSettings();
  const [key, saveKey, forgetKey] = useKey();
  const [adminIn, adminLogin, adminLogout] = useAdmin();
  const [adminForm, setAdminForm] = useState(false);
  // Админ не задан в сборке — ограничений нет (как раньше)
  const admin = !adminEnabled() || adminIn === true;
  const runner = useRunnerState(settings.author, admin);
  const [tab, setTab] = useState<Tab>('emotes');
  const tabs = admin ? (Object.keys(TABS) as Tab[]) : USER_TABS;
  const shown = tabs.includes(tab) ? tab : 'emotes';

  if (!isConfigured()) {
    return <div class="app card notice">Расширение собрано без адреса репозитория. Заполните <code>.env</code> и пересоберите.</div>;
  }
  if (key === null || adminIn === null) return null;

  return (
    <RunnerContext.Provider value={runner}>
      <div class="app">
        <header>
          <h1 class="grow">🦉 Owl Smile</h1>
          {key && (
            <>
              <label class="row">
                <span class="muted small">Ваш ник (подпись к загрузкам)</span>
                <input value={settings.author} maxLength={40} placeholder="ник" onInput={(e) => setSettings({ author: e.currentTarget.value })} />
              </label>
              {adminEnabled() &&
                (adminIn ? (
                  <button class="ghost xs" title="Удалить ключ админа с этого компьютера" onClick={() => void adminLogout()}>
                    Админ · выйти
                  </button>
                ) : (
                  <button class="ghost xs" onClick={() => setAdminForm(!adminForm)}>
                    Вход админа
                  </button>
                ))}
              <button class="ghost xs" title="Удалить ключ с этого компьютера" onClick={() => confirm('Удалить ключ доступа с этого компьютера?') && void forgetKey()}>
                Сменить ключ
              </button>
            </>
          )}
        </header>
        {!key ? (
          <KeyForm onSave={saveKey} />
        ) : (
          <>
            {adminForm && !adminIn && (
              <AdminForm
                onCancel={() => setAdminForm(false)}
                onLogin={async (nick, adminKey) => {
                  await adminLogin(adminKey);
                  setSettings({ author: nick });
                  setAdminForm(false);
                }}
              />
            )}
            <StatusLine />
            <nav class="tabs">
              {tabs.map((t) => (
                <button key={t} class={t === shown ? 'active' : ''} onClick={() => setTab(t)}>
                  {TABS[t]}
                </button>
              ))}
            </nav>
            {shown === 'emotes' && <EmotesTab cache={cache} author={settings.author} actor={{ nick: settings.author, admin }} />}
            {shown === 'badges' && <BadgesTab cache={cache} author={settings.author} />}
            {shown === 'paints' && <PaintsTab cache={cache} />}
            {shown === 'nameplates' && <NameplatesTab cache={cache} author={settings.author} />}
            {shown === 'users' && <UsersTab cache={cache} />}
          </>
        )}
        <p class="muted small">
          Хранилище: gitflic.ru/project/{config.owner}/{config.repo} · изменения видят все после синхронизации (до 15 мин или по кнопке в меню расширения)
        </p>
      </div>
    </RunnerContext.Provider>
  );
}

render(<App />, document.getElementById('app')!);
