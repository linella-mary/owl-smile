import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { K_INDEX, K_STATUS, getIndex, getStatus, type LocalIndex, type SyncStatus } from '../../shared/cache';
import { requestSync } from '../../shared/messages';

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  return new Date(ts).toLocaleString('ru-RU');
}

function Popup() {
  const [index, setIndex] = useState<LocalIndex | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    const load = () => {
      void getIndex().then(setIndex);
      void getStatus().then(setStatus);
    };
    load();
    const onChange = (ch: Record<string, unknown>) => {
      if (K_INDEX in ch || K_STATUS in ch) load();
    };
    browser.storage.local.onChanged.addListener(onChange);
    return () => browser.storage.local.onChanged.removeListener(onChange);
  }, []);

  const syncing = status?.state === 'syncing';
  const count = (o?: object) => (o ? Object.keys(o).length : 0);

  return (
    <div class="stack">
      <h1>🦉 Owl Smile</h1>
      <div>
        Смайлов: <b>{count(index?.emotes)}</b> · иконок: <b>{count(index?.badges)}</b> · эффектов: <b>{count(index?.paints)}</b>
      </div>
      <div class="muted">
        {syncing && 'Синхронизация…'}
        {status?.state === 'idle' && `Синхронизировано ${timeAgo(status.at)}`}
        {status?.state === 'error' && <span class="err">Ошибка: {status.error}</span>}
        {!status && 'Ещё не синхронизировано'}
      </div>
      <div class="row">
        <button disabled={syncing} onClick={() => void requestSync(true)}>
          Синхронизировать
        </button>
        <button class="ghost" onClick={() => void browser.tabs.create({ url: browser.runtime.getURL('/manage.html') })}>
          Загрузить…
        </button>
      </div>
    </div>
  );
}

render(<Popup />, document.getElementById('app')!);
