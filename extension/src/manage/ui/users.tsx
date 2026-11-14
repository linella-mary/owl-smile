import { useState } from 'preact/hooks';
import { isValidNick, normalizeNick, PLATFORMS, PLATFORM_TITLES, type Platform } from '../../shared/ids';
import { combine, setProfile, setUser, type ProfileInfo } from '../ops';
import { useRunner, type CacheView } from './common';
import { cachedPlate, DecoratedName } from './nameplates';
import { PaintedName } from './paints';
import { infoFromProfile, ProfileFields } from './profile';

export function UsersTab({ cache }: { cache: CacheView }) {
  const runner = useRunner();
  const [platform, setPlatform] = useState<Platform>('twitch');
  const [nick, setNick] = useState('');
  const [badges, setBadges] = useState<string[]>([]);
  const [paint, setPaint] = useState('');
  const [plate, setPlate] = useState('');
  const [info, setInfo] = useState<ProfileInfo>({});

  const allBadges = Object.entries(cache.index?.badges ?? {});
  const allPaints = Object.values(cache.index?.paints ?? {});
  const allPlates = Object.entries(cache.index?.nameplates ?? {});
  const profiles = cache.index?.profiles ?? {};
  // Оформленные: иконки/эффект (users/) или подложка (profiles/)
  const keys = [...new Set([...Object.keys(cache.index?.users ?? {}), ...Object.keys(profiles)])].sort();
  const users = keys.map((k) => [k, cache.index?.users[k] ?? { badges: [] }] as const);
  const n = normalizeNick(nick);
  const nickOk = isValidNick(platform, n);

  const edit = (key: string) => {
    const p = key.slice(0, key.indexOf(':')) as Platform;
    const name = key.slice(key.indexOf(':') + 1);
    const u = cache.index!.users[key] ?? { badges: [] };
    setPlatform(p);
    setNick(name);
    setBadges(u.badges);
    setPaint(u.paint ?? '');
    setPlate(profiles[key]?.nameplate ?? '');
    setInfo(infoFromProfile(profiles[key]));
    scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggle = (id: string) =>
    setBadges(badges.includes(id) ? badges.filter((b) => b !== id) : badges.length < 3 ? [...badges, id] : badges);

  const save = (cosmetics: { badges: string[]; paint?: string }, title: string) => {
    // «Также на» той же площадки (после смены площадки в форме) — не сохраняем
    const clean = info.alsoOn?.platform === platform ? { ...info, alsoOn: undefined } : info;
    let mutation;
    try {
      mutation = combine(setUser(platform, n, cosmetics), setProfile(platform, n, { nameplate: plate || undefined, info: clean }));
    } catch (e) {
      return runner.fail(e);
    }
    return runner.run(title, mutation);
  };

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

        <div class="field">
          <span>Подложка под ник</span>
          <div class="row wrap">
            <button class={`ghost xs chip ${!plate ? 'active' : ''}`} onClick={() => setPlate('')}>Без подложки</button>
            {allPlates.map(([id, p]) => (
              <button key={id} class={`ghost xs chip ${plate === id ? 'active' : ''}`} onClick={() => setPlate(id)}>
                <DecoratedName name={p.title} plate={cachedPlate(cache, id)} />
              </button>
            ))}
            {!allPlates.length && <span class="muted small">Подложек пока нет — создайте на вкладке «Подложки»</span>}
          </div>
        </div>

        <details class="profile-box" open={Object.keys(info).length > 0}>
          <summary>Профиль Owl — карточка по клику на ник</summary>
          <ProfileFields value={info} onChange={setInfo} cache={cache} platform={platform} />
        </details>

        <div class="row">
          <span class="chat-sample big grow">
            {badges.map((id) => cache.index?.badges[id] && <img key={id} class="owl-badge" src={cache.images[cache.index.badges[id].img]} alt="" />)}{' '}
            <DecoratedName paint={paint ? cache.index?.paints[paint] : null} plate={cachedPlate(cache, plate || undefined)} name={nick || 'ник'} />: привет!
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
                <DecoratedName paint={u.paint ? cache.index?.paints[u.paint] : null} plate={cachedPlate(cache, profiles[key]?.nameplate)} name={name} />
              </span>
              <button class="ghost xs" onClick={() => edit(key)}>Изменить</button>
              <button class="ghost xs danger" disabled={runner.busy}
                onClick={() => confirm(`Снять оформление с ${name}?`) && void runner.run(`Снято оформление ${key}`, combine(setUser(p, name, { badges: [] }), setProfile(p, name, { nameplate: undefined, info: {} })))}>
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
