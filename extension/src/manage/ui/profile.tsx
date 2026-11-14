import { useState } from 'preact/hooks';
import type { LocalProfile } from '../../shared/cache';
import {
  PLATFORMS,
  PLATFORM_TITLES,
  PROFILE_LANGUAGES,
  PROFILE_LIMITS as L,
  isSafeUrl,
  isValidBirthday,
  isValidNick,
  normalizeNick,
  type Platform,
} from '../../shared/ids';
import type { ProfileInfo } from '../ops';
import type { CacheView } from './common';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const ZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Europe/Moscow'];
  }
})();
const languageNames = new Intl.DisplayNames(['ru'], { type: 'language' });
export const languageName = (code: string) => languageNames.of(code) ?? code;

/** Профиль из кэша → значения формы (без служебных полей). */
export function infoFromProfile(p: LocalProfile | undefined): ProfileInfo {
  if (!p) return {};
  const { nameplate: _, since: __, ...info } = p;
  return structuredClone(info);
}

/** Поля профиля зрителя: о себе, местоимения, ссылки, любимые смайлы, другая площадка, цвет. */
export function ProfileFields({ value, onChange, cache, platform }: {
  value: ProfileInfo; onChange: (v: ProfileInfo) => void; cache: CacheView; platform: Platform;
}) {
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const set = (patch: Partial<ProfileInfo>) => onChange({ ...value, ...patch });
  const interests = value.interests ?? [];
  const languages = value.languages ?? [];
  const bday = { m: value.birthday?.slice(0, 2) ?? '', d: value.birthday?.slice(3, 5) ?? '' };
  // День и месяц выбираются по отдельности: пока не выбраны оба — дня рождения нет
  const setBirthday = (d: string, m: string) => set({ birthday: d && m ? `${m}-${d}` : d || m ? `${m || '00'}-${d || '00'}` : undefined });
  const links = value.links ?? [];
  const favs = value.favEmotes ?? [];
  const emotes = cache.index?.emotes ?? {};
  const found = q.trim()
    ? Object.keys(emotes).filter((c) => c.toLowerCase().includes(q.trim().toLowerCase()) && !favs.includes(c)).sort().slice(0, 24)
    : [];
  const other = PLATFORMS.find((p) => p !== platform)!;
  const alsoOn = value.alsoOn;
  const alsoNick = alsoOn ? normalizeNick(alsoOn.nick) : '';

  return (
    <div class="stack profile-fields">
      <div class="row">
        <label class="field grow">
          <span>О себе · {value.about?.length ?? 0}/{L.about}</span>
          <textarea rows={3} maxLength={L.about} value={value.about ?? ''} placeholder="Пару слов о себе — видно в карточке по клику на ник"
            onInput={(e) => set({ about: e.currentTarget.value })} />
        </label>
      </div>
      <div class="row wrap">
        <label class="field">
          <span>Местоимения</span>
          <input maxLength={L.pronouns} value={value.pronouns ?? ''} placeholder="он/его, она/её…" onInput={(e) => set({ pronouns: e.currentTarget.value })} />
        </label>
        <label class="field">
          <span>Цвет шапки карточки</span>
          <div class="row">
            <input type="color" value={value.accent ?? '#2a2a30'} onInput={(e) => set({ accent: e.currentTarget.value })} />
            {value.accent && <button class="ghost xs" onClick={() => set({ accent: undefined })}>Без цвета</button>}
          </div>
        </label>
        <label class="field grow">
          <span>Также на {PLATFORM_TITLES[other]}</span>
          <input value={alsoOn?.platform === other ? alsoOn.nick : ''} placeholder={other === 'twitch' ? 'логин на Twitch' : 'ник в VK Live'}
            onInput={(e) => set({ alsoOn: e.currentTarget.value ? { platform: other, nick: e.currentTarget.value } : undefined })} />
          {alsoOn && alsoNick && !isValidNick(alsoOn.platform, alsoNick) && <span class="err small">Некорректный ник</span>}
        </label>
      </div>

      <div class="row wrap">
        <label class="field grow">
          <span>Статус · {value.status?.length ?? 0}/{L.status}</span>
          <input maxLength={L.status} value={value.status ?? ''} placeholder="Играю в Elden Ring, ищу пати" onInput={(e) => set({ status: e.currentTarget.value })} />
        </label>
        <div class="field">
          <span>День рождения</span>
          <div class="row">
            <select value={bday.d} aria-label="День" onChange={(e) => setBirthday(e.currentTarget.value, bday.m)}>
              <option value="">—</option>
              {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => <option key={d} value={d}>{Number(d)}</option>)}
            </select>
            <select value={bday.m} aria-label="Месяц" onChange={(e) => setBirthday(bday.d, e.currentTarget.value)}>
              <option value="">—</option>
              {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
            </select>
          </div>
          {value.birthday && !isValidBirthday(value.birthday) && <span class="err small">Такой даты нет</span>}
        </div>
        <div class="field">
          <span>Часовой пояс (для «местное время»)</span>
          <div class="row">
            <select value={value.timezone ?? ''} onChange={(e) => set({ timezone: e.currentTarget.value || undefined })}>
              <option value="">не показывать</option>
              {ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
            </select>
            <button class="ghost xs" title="Часовой пояс этого компьютера" onClick={() => set({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}>мой</button>
          </div>
        </div>
      </div>

      <div class="field">
        <span>Интересы (до {L.interests}, Enter — добавить)</span>
        <div class="row wrap">
          {interests.map((t) => (
            <button key={t} class="ghost xs chip" title="Убрать" onClick={() => set({ interests: interests.filter((x) => x !== t) })}>{t} ×</button>
          ))}
          {interests.length < L.interests && (
            <input class="fav-search" value={tag} maxLength={L.interest} placeholder="аниме, CS2, соулсы…"
              onInput={(e) => setTag(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !tag.trim()) return;
                e.preventDefault();
                if (!interests.includes(tag.trim())) set({ interests: [...interests, tag.trim()] });
                setTag('');
              }} />
          )}
        </div>
      </div>

      <div class="field">
        <span>Языки (до {L.languages})</span>
        <div class="row wrap">
          {PROFILE_LANGUAGES.map((code) => {
            const on = languages.includes(code);
            return (
              <button key={code} class={`ghost xs chip ${on ? 'active' : ''}`} disabled={!on && languages.length >= L.languages}
                onClick={() => set({ languages: on ? languages.filter((x) => x !== code) : [...languages, code] })}>
                {languageName(code)}
              </button>
            );
          })}
        </div>
      </div>

      <div class="field">
        <span>Ссылки (только https://, до {L.links})</span>
        {links.map((l, i) => (
          <div class="row" key={i}>
            <input class="link-title" maxLength={L.linkTitle} value={l.title} placeholder="Название"
              onInput={(e) => set({ links: links.map((x, j) => (j === i ? { ...x, title: e.currentTarget.value } : x)) })} />
            <input class={`grow ${l.url && !isSafeUrl(l.url.trim()) ? 'invalid' : ''}`} value={l.url} placeholder="https://…"
              onInput={(e) => set({ links: links.map((x, j) => (j === i ? { ...x, url: e.currentTarget.value } : x)) })} />
            <button class="ghost xs" title="Убрать" onClick={() => set({ links: links.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        {links.some((l) => l.url && !isSafeUrl(l.url.trim())) && <span class="err small">Ссылка должна начинаться с https:// и быть не длиннее 200 символов</span>}
        {links.length < L.links && (
          <div><button class="ghost xs" onClick={() => set({ links: [...links, { title: '', url: '' }] })}>+ ссылка</button></div>
        )}
      </div>

      <div class="field">
        <span>Любимые смайлы Owl Smile (до {L.favEmotes})</span>
        <div class="row wrap">
          {favs.map((code) => (
            <button key={code} class="ghost xs chip" title="Убрать" onClick={() => set({ favEmotes: favs.filter((c) => c !== code) })}>
              {emotes[code] && cache.images[emotes[code].img] && <img class="fav-img" src={cache.images[emotes[code].img]} alt="" />} {code} ×
            </button>
          ))}
          {favs.length < L.favEmotes && (
            <input class="fav-search" value={q} placeholder="найти смайл…" onInput={(e) => setQ(e.currentTarget.value)} />
          )}
        </div>
        {found.length > 0 && favs.length < L.favEmotes && (
          <div class="row wrap">
            {found.map((code) => (
              <button key={code} class="ghost xs chip" onClick={() => { set({ favEmotes: [...favs, code] }); setQ(''); }}>
                {cache.images[emotes[code]!.img] && <img class="fav-img" src={cache.images[emotes[code]!.img]} alt="" />} {code}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
