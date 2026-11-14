import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { K_BTTV_GLOBAL, K_BTTV_SETTING, bttvChannelKey, type BttvChannel, type BttvGlobal } from '../../shared/bttv';
import { K_INDEX, K_STATUS, getIndex, getStatus, type LocalIndex, type SyncStatus } from '../../shared/cache';
import { requestSync, type OwlMessage } from '../../shared/messages';

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  return new Date(ts).toLocaleString('ru-RU');
}

/** «1 смайл», «3 смайла», «5 смайлов» */
function emotesWord(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  const word = d === 1 && dd !== 11 ? 'смайл' : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'смайла' : 'смайлов';
  return `${n} ${word}`;
}

/** Смайлы BetterTTV: Twitch-канал, чьи смайлы показывать на VK Live. */
function Bttv() {
  const [global, setGlobal] = useState<BttvGlobal | null>(null);
  const [login, setLogin] = useState<string | null>(null);
  const [channel, setChannel] = useState<BttvChannel | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let current: string | null = null;
    const load = async (fillInput: boolean) => {
      const got = await browser.storage.local.get([K_BTTV_GLOBAL, K_BTTV_SETTING]);
      current = (got[K_BTTV_SETTING] as string | undefined) ?? null;
      setGlobal((got[K_BTTV_GLOBAL] as BttvGlobal | undefined) ?? null);
      setLogin(current);
      if (fillInput) setValue(current ?? '');
      const key = current ? bttvChannelKey(current) : null;
      setChannel(key ? (((await browser.storage.local.get(key))[key] as BttvChannel | undefined) ?? null) : null);
    };
    void load(true);
    const onChange = (ch: Record<string, unknown>) => {
      if (K_BTTV_GLOBAL in ch || K_BTTV_SETTING in ch || (current && bttvChannelKey(current) in ch)) void load(false);
    };
    browser.storage.local.onChanged.addListener(onChange);
    return () => browser.storage.local.onChanged.removeListener(onChange);
  }, []);

  const save = async (e: Event) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const res = (await browser.runtime.sendMessage({ type: 'owl:bttv-setting', value } satisfies OwlMessage)) as
      | { ok: boolean; login: string | null; error?: string }
      | undefined;
    setSaving(false);
    // Сохранённый логин — в поле в чистом виде (вместо ссылки); при ошибке ввод не трогаем
    if (res && (res.ok || res.login)) setValue(res.login ?? '');
    if (!res || !res.ok) setError(res?.error ?? 'Не получилось');
  };

  let channelLine = '';
  if (login && channel) {
    if (channel.missing) channelLine = `У канала ${channel.name} нет смайлов BetterTTV`;
    else if (channel.at) channelLine = `Канал ${channel.name}: ${emotesWord(channel.emotes.length)}`;
  } else if (login) channelLine = 'Загрузка смайлов канала…';

  return (
    <form class="stack bttv" onSubmit={(e) => void save(e)}>
      <h2>BetterTTV</h2>
      <div class="muted">
        Глобальных смайлов: <b>{global?.emotes.length ?? 0}</b>
        {global?.error && <span class="err"> · не обновились: {global.error}</span>}
      </div>
      <label class="muted" for="bttv-channel">
        Twitch-канал, чьи смайлы показывать на VK Live (на Twitch — всегда открытый канал)
      </label>
      <div class="row">
        <input id="bttv-channel" placeholder="например, forsen" value={value} onInput={(e) => setValue(e.currentTarget.value)} />
        <button disabled={saving || value.trim() === (login ?? '')}>{saving ? '…' : 'Сохранить'}</button>
      </div>
      {error ? <div class="muted err">{error}</div> : channelLine && <div class="muted">{channelLine}</div>}
      {!error && channel?.error && channel.at > 0 && <div class="muted err">Не обновились: {channel.error}</div>}
    </form>
  );
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
      <Bttv />
    </div>
  );
}

render(<Popup />, document.getElementById('app')!);
