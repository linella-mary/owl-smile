import { useState } from 'preact/hooks';
import { isValidNick, normalizeNick, PLATFORMS, PLATFORM_TITLES, type Platform } from '../../shared/ids';
import { setUser } from '../ops';
import { useRunner, type CacheView } from './common';
import { PaintedName } from './paints';

export function UsersTab({ cache }: { cache: CacheView }) {
  const runner = useRunner();
  const [platform, setPlatform] = useState<Platform>('twitch');
  const [nick, setNick] = useState('');
  const [badges, setBadges] = useState<string[]>([]);
  const [paint, setPaint] = useState('');

  const allBadges = Object.entries(cache.index?.badges ?? {});
  const allPaints = Object.values(cache.index?.paints ?? {});
  const users = Object.entries(cache.index?.users ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const n = normalizeNick(nick);
  const nickOk = isValidNick(platform, n);

  const edit = (key: string) => {
    const p = key.slice(0, key.indexOf(':')) as Platform;
    const name = key.slice(key.indexOf(':') + 1);
    const u = cache.index!.users[key]!;
    setPlatform(p);
    setNick(name);
    setBadges(u.badges);
    setPaint(u.paint ?? '');
  };

  const toggle = (id: string) =>
    setBadges(badges.includes(id) ? badges.filter((b) => b !== id) : badges.length < 3 ? [...badges, id] : badges);

  const save = (cosmetics: { badges: string[]; paint?: string }, title: string) =>
    runner.run(title, setUser(platform, n, cosmetics));

  return (
    <div class="stack">
      <section class="card stack">
        <div class="row">
          <select value={platform} onChange={(e) => setPlatform(e.currentTarget.value as Platform)}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_TITLES[p]}</option>)}
          </select>
          <input class="grow" value={nick} placeholder={platform === 'twitch' ? 'логин на Twitch, например owl_viewer' : 'ник в VK Live как в чате, например Данил Кузнецов'} onInput={(e) => setNick(e.currentTarget.value)} />
        </div>
        {nick && !nickOk && <div class="err small">{platform === 'twitch' ? 'Логин Twitch: латиница, цифры и _ (как в адресе канала)' : 'Ник VK Live: как в чате, без двоеточия'}</div>}

        <div class="field">
          <span>Иконки (до 3)</span>
          <div class="row wrap">
            {allBadges.map(([id, b]) => (
              <button key={id} class={`ghost xs chip ${badges.includes(id) ? 'active' : ''}`} onClick={() => toggle(id)} title={b.title}>
                {cache.images[b.img] && <img class="owl-badge" src={cache.images[b.img]} alt="" />} {b.title}
              </button>
            ))}
            {!allBadges.length && <span class="muted small">Сначала загрузите иконки</span>}
          </div>
        </div>

        <div class="field">
          <span>Эффект ника</span>
          <div class="row wrap">
            <button class={`ghost xs chip ${!paint ? 'active' : ''}`} onClick={() => setPaint('')}>Без эффекта</button>
            {allPaints.map((p) => (
              <button key={p.id} class={`ghost xs chip ${paint === p.id ? 'active' : ''}`} onClick={() => setPaint(p.id)}>
                <PaintedName paint={p} name={p.title} />
              </button>
            ))}
          </div>
        </div>

        <div class="row">
          <span class="chat-sample big grow">
            {badges.map((id) => cache.index?.badges[id] && <img key={id} class="owl-badge" src={cache.images[cache.index.badges[id].img]} alt="" />)}{' '}
            <PaintedName paint={paint ? cache.index?.paints[paint] : null} name={nick || 'ник'} />: привет!
          </span>
          <button disabled={!nickOk || runner.busy}
            onClick={() => void save(paint ? { badges, paint } : { badges }, `Оформление ${PLATFORM_TITLES[platform]}:${n}`)}>
            Сохранить
          </button>
        </div>
      </section>

      <h2>Оформленные зрители · {users.length}</h2>
      <div class="list">
        {users.map(([key, u]) => {
          const p = key.slice(0, key.indexOf(':')) as Platform;
          const name = key.slice(key.indexOf(':') + 1);
          return (
            <div class="list-row" key={key}>
              <span class="tag">{PLATFORM_TITLES[p]}</span>
              <span class="chat-sample grow">
                {u.badges.map((id) => cache.index?.badges[id] && <img key={id} class="owl-badge" src={cache.images[cache.index.badges[id].img]} alt="" />)}{' '}
                <PaintedName paint={u.paint ? cache.index?.paints[u.paint] : null} name={name} />
              </span>
              <button class="ghost xs" onClick={() => edit(key)}>Изменить</button>
              <button class="ghost xs danger" disabled={runner.busy}
                onClick={() => confirm(`Снять оформление с ${name}?`) && void runner.run(`Снято оформление ${key}`, setUser(p, name, { badges: [] }))}>
                Снять
              </button>
            </div>
          );
        })}
        {!users.length && <div class="muted">Пока никого</div>}
      </div>
    </div>
  );
}
