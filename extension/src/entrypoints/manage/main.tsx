import { render } from 'preact';
import { useState } from 'preact/hooks';
import { config, isConfigured } from '../../shared/config';
import { BadgesTab } from '../../manage/ui/badges';
import { RunnerContext, StatusLine, useCache, useRunnerState, useSettings } from '../../manage/ui/common';
import { EmotesTab } from '../../manage/ui/emotes';
import { KeyForm, useKey } from '../../manage/ui/key';
import { PaintsTab } from '../../manage/ui/paints';
import { UsersTab } from '../../manage/ui/users';

const TABS = { emotes: 'Смайлы', badges: 'Иконки', paints: 'Эффекты ников', users: 'Зрители' } as const;
type Tab = keyof typeof TABS;

function App() {
  const cache = useCache();
  const [settings, setSettings] = useSettings();
  const [key, saveKey, forgetKey] = useKey();
  const runner = useRunnerState(settings.author);
  const [tab, setTab] = useState<Tab>('emotes');

  if (!isConfigured()) {
    return <div class="app card notice">Расширение собрано без адреса репозитория. Заполните <code>.env</code> и пересоберите.</div>;
  }
  if (key === null) return null;

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
            <StatusLine />
            <nav class="tabs">
              {(Object.keys(TABS) as Tab[]).map((t) => (
                <button key={t} class={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
                  {TABS[t]}
                </button>
              ))}
            </nav>
            {tab === 'emotes' && <EmotesTab cache={cache} author={settings.author} />}
            {tab === 'badges' && <BadgesTab cache={cache} author={settings.author} />}
            {tab === 'paints' && <PaintsTab cache={cache} />}
            {tab === 'users' && <UsersTab cache={cache} />}
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
