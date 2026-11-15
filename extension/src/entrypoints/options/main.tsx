import { render, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { applySettings } from '../../core/apply-settings';
import { plateView } from '../../core/paint';
import { installHover } from '../../core/hover';
import { ChatRenderer, emptyData, type RenderData } from '../../core/renderer';
import { loadRenderData } from '../../core/start';
import { twitchAdapter } from '../../platforms/twitch';
import type { ChatAdapter } from '../../platforms/types';
import { K_BTTV_GLOBAL } from '../../shared/bttv';
import { K_INDEX } from '../../shared/cache';
import { PLATFORM_TITLES, PLATFORMS, type Platform } from '../../shared/ids';
import {
  DEFAULT_BOTS,
  DEFAULT_SETTINGS,
  LIMITS,
  isActive,
  loadSettings,
  normalizeSettings,
  onSettingsChanged,
  resetSettings,
  saveSettings,
  type Settings,
} from '../../shared/settings';

type Update = (patch: Partial<Settings>) => void;

/** Настройки страницы: меняются сразу, в хранилище пишутся с задержкой (у storage.sync лимит записей в минуту). */
function useSettings(): [Settings | null, Update, string] {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const pending = useRef<Partial<Settings>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    void loadSettings().then(setS);
    return onSettingsChanged((next) => {
      if (!Object.keys(pending.current).length) setS(next);
    });
  }, []);

  const update: Update = (patch) => {
    setS((prev) => normalizeSettings({ ...prev, ...patch }));
    pending.current = { ...pending.current, ...patch };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const p = pending.current;
      pending.current = {};
      saveSettings(p).then(
        () => setError(''),
        (e: unknown) => setError(`Не сохранилось: ${e instanceof Error ? e.message : String(e)}`),
      );
    }, 350);
  };
  return [s, update, error];
}

// ——— Элементы управления ———

function Opt(props: { title: string; hint?: ComponentChildren; children: ComponentChildren; block?: boolean; disabled?: boolean }) {
  return (
    <div class={`opt ${props.block ? 'block' : ''} ${props.disabled ? 'disabled' : ''}`}>
      <div class="text">
        <div class="title">{props.title}</div>
        {props.hint && <div class="hint">{props.hint}</div>}
      </div>
      <div class="control">{props.children}</div>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label class="switch" title={label}>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span />
    </label>
  );
}

function Toggle({ s, k, update, title, hint, disabled }: {
  s: Settings; k: { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]; update: Update;
  title: string; hint?: ComponentChildren; disabled?: boolean;
}) {
  return (
    <Opt title={title} hint={hint} disabled={disabled}>
      <Switch label={title} checked={s[k]} onChange={(v) => update({ [k]: v })} />
    </Opt>
  );
}

function Range({ s, k, update, title, hint, step = 1, format, disabled }: {
  s: Settings; k: keyof typeof LIMITS; update: Update; title: string; hint?: ComponentChildren; step?: number;
  format?: (v: number) => string; disabled?: boolean;
}) {
  const [min, max] = LIMITS[k];
  const v = s[k];
  return (
    <Opt title={title} hint={hint} disabled={disabled}>
      <input type="range" min={min} max={max} step={step} value={v} aria-label={title}
        onInput={(e) => update({ [k]: Number(e.currentTarget.value) })} />
      <span class="range-value">{format ? format(v) : `${v} px`}</span>
      {v !== DEFAULT_SETTINGS[k] && (
        <button class="ghost xs" title="Как было" onClick={() => update({ [k]: DEFAULT_SETTINGS[k] })}>↺</button>
      )}
    </Opt>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="seg" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={value === v} class={value === v ? 'active' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Список по одному в строке. Текст в поле не переписывается на ходу — чистится при сохранении. */
function ListField({ value, onChange, placeholder, label }: {
  value: string[]; onChange: (v: string[]) => void; placeholder: string; label: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(value.join('\n'));
  const joined = value.join('\n');
  useEffect(() => {
    if (document.activeElement !== ref.current) setText(joined);
  }, [joined]);
  return (
    <textarea ref={ref} value={text} placeholder={placeholder} aria-label={label} spellcheck={false}
      onInput={(e) => {
        setText(e.currentTarget.value);
        onChange(e.currentTarget.value.split('\n'));
      }}
      onBlur={() => setText(joined)} />
  );
}

// ——— Разделы ———

function General({ s, update }: { s: Settings; update: Update }) {
  return (
    <section class="card">
      <h2>Площадки</h2>
      {PLATFORMS.map((p) => (
        <Opt key={p} title={PLATFORM_TITLES[p]} hint={p === 'twitch' ? 'twitch.tv, всплывающий чат и чат записей' : 'live.vkvideo.ru'}>
          <Switch label={PLATFORM_TITLES[p]} checked={s.platforms[p]} onChange={(v) => update({ platforms: { ...s.platforms, [p]: v } })} />
        </Opt>
      ))}
      <p class="muted small">
        Быстро включить и выключить всё: значок 🦉 на панели браузера или <kbd>Alt+Shift+O</kbd> (сочетание меняется в{' '}
        <a href="#" onClick={(e) => { e.preventDefault(); void browser.tabs.create({ url: 'chrome://extensions/shortcuts' }); }}>
          настройках браузера
        </a>).
      </p>
    </section>
  );
}

function Emotes({ s, update }: { s: Settings; update: Update }) {
  return (
    <section class="card">
      <h2>Смайлы</h2>
      <Toggle s={s} k="owlEmotes" update={update} title="Смайлы Owl Smile" />
      <Toggle s={s} k="bttvEmotes" update={update} title="Смайлы BetterTTV" hint="Глобальные и смайлы канала" />
      <Range s={s} k="emoteSize" update={update} title="Размер в чате Twitch" />
      <Range s={s} k="emoteSizeVk" update={update} title="Размер в чате VK Live" />
      <Opt title="Анимированные смайлы" hint="«При наведении» и «не двигаются» снимают нагрузку и не отвлекают в быстром чате">
        <Seg value={s.animation} onChange={(animation) => update({ animation })}
          options={[['always', 'Всегда'], ['hover', 'При наведении'], ['off', 'Не двигаются']]} />
      </Opt>
      <Toggle s={s} k="hoverPreview" update={update} title="Подсказка при наведении" hint="Крупный смайл, код и кто его загрузил" />
    </section>
  );
}

function Cosmetics({ s, update }: { s: Settings; update: Update }) {
  return (
    <section class="card">
      <h2>Иконки и эффекты ников</h2>
      <Toggle s={s} k="badges" update={update} title="Иконки у ников" />
      <Range s={s} k="badgeSize" update={update} title="Размер иконок на Twitch" disabled={!s.badges} />
      <Range s={s} k="badgeSizeVk" update={update} title="Размер иконок на VK Live" disabled={!s.badges} />
      <Toggle s={s} k="paints" update={update} title="Эффекты ников" hint="Градиенты, свечение, переливание" />
      <Toggle s={s} k="paintAnimation" update={update} title="Анимация эффектов" hint="Выключено — переливание и мерцание стоят на месте" disabled={!s.paints} />
      <Toggle s={s} k="nameplates" update={update} title="Подложки под ники" hint="Картинка или узор из эмодзи за ником" />
      <Toggle s={s} k="profiles" update={update} title="Профиль Owl по клику на ник"
        hint="Twitch — блок Owl в карточке зрителя. VK Live — наша карточка у пользователей Owl Smile (Alt+клик — карточка VK)" />
    </section>
  );
}

function Messages({ s, update }: { s: Settings; update: Update }) {
  return (
    <section class="card">
      <h2>Вид сообщений</h2>
      <Range s={s} k="fontSize" update={update} title="Размер шрифта" format={(v) => (v ? `${v} px` : 'как есть')} />
      <Range s={s} k="lineSpacing" update={update} title="Межстрочный интервал" step={0.1} format={(v) => (v ? `×${v.toFixed(1)}` : 'как есть')} />
      <Toggle s={s} k="zebra" update={update} title="Чередовать фон сообщений" />
      <Toggle s={s} k="separators" update={update} title="Линии между сообщениями" />
      <Toggle s={s} k="timestamps" update={update} title="Время сообщений" hint="Только Twitch (в VK Live время есть всегда), для сообщений, пришедших при открытом чате" />

      <h2 style="margin-top:14px">Подсветка</h2>
      {PLATFORMS.map((p) => (
        <Opt key={p} title={`Мой ник на ${PLATFORM_TITLES[p]}`} hint="Сообщения с упоминанием ника подсвечиваются">
          <input value={s.myNicks[p]} maxLength={60} placeholder={p === 'twitch' ? 'логин' : 'ник как в чате'} aria-label={`Мой ник на ${PLATFORM_TITLES[p]}`}
            onInput={(e) => update({ myNicks: { ...s.myNicks, [p]: e.currentTarget.value } })} />
        </Opt>
      ))}
      <Toggle s={s} k="highlightMentions" update={update} title="Подсвечивать упоминания" />
      <Opt title="Цвет подсветки">
        <input type="color" value={s.highlightColor} aria-label="Цвет подсветки" onInput={(e) => update({ highlightColor: e.currentTarget.value })} />
      </Opt>
      <Opt block title="Подсвечивать слова" hint="По одному в строке. Одно слово ищется целиком, фраза — как есть. Регистр не важен">
        <ListField label="Подсвечивать слова" value={s.highlightWords} placeholder={'розыгрыш\nвопрос стримеру'} onChange={(highlightWords) => update({ highlightWords })} />
      </Opt>
      <Opt block title="Подсвечивать зрителей" hint="Ники по одному в строке">
        <ListField label="Подсвечивать зрителей" value={s.highlightUsers} placeholder="owl_viewer" onChange={(highlightUsers) => update({ highlightUsers })} />
      </Opt>
    </section>
  );
}

function Filters({ s, update }: { s: Settings; update: Update }) {
  return (
    <section class="card">
      <h2>Фильтры</h2>
      <Opt title="Как скрывать" hint="Свёрнутое сообщение можно раскрыть щелчком">
        <Seg value={s.filterMode} onChange={(filterMode) => update({ filterMode })} options={[['collapse', 'Сворачивать'], ['hide', 'Убирать совсем']]} />
      </Opt>
      <Opt block title="Скрывать сообщения со словами" hint="По одному в строке. Одно слово ищется целиком, фраза — как есть">
        <ListField label="Скрывать слова" value={s.hideWords} placeholder={'спойлер\nкто выиграл'} onChange={(hideWords) => update({ hideWords })} />
      </Opt>
      <Opt block title="Скрывать зрителей" hint="Ники по одному в строке (Twitch — логин, VK Live — как в чате)">
        <ListField label="Скрывать зрителей" value={s.hideUsers} placeholder="spammer_123" onChange={(hideUsers) => update({ hideUsers })} />
      </Opt>
      <Toggle s={s} k="hideBots" update={update} title="Скрывать ботов" />
      <Opt block title="Боты" disabled={!s.hideBots}
        hint={<>Ники по одному в строке. <a href="#" onClick={(e) => { e.preventDefault(); update({ bots: DEFAULT_BOTS }); }}>Вернуть список по умолчанию</a></>}>
        <ListField label="Боты" value={s.bots} placeholder="nightbot" onChange={(bots) => update({ bots })} />
      </Opt>
    </section>
  );
}

function Picker({ s, update }: { s: Settings; update: Update }) {
  return (
    <section class="card">
      <h2>Окно смайлов</h2>
      <Toggle s={s} k="pickerButton" update={update} title="Кнопка 🦉 у поля ввода" />
      {s.pickerButton && (
        <Opt title="Где кнопка">
          <Seg value={s.pickerPlace} onChange={(pickerPlace) => update({ pickerPlace })}
            options={[['toolbar', 'Под полем ввода'], ['input', 'В поле ввода']]} />
        </Opt>
      )}
      <Toggle s={s} k="tabCompletion" update={update} title="Дополнение кода смайла по Tab" />
      <Range s={s} k="pickerEmoteSize" update={update} title="Размер смайлов в окне" />
      <Range s={s} k="recentCount" update={update} title="Недавних смайлов" format={(v) => (v ? String(v) : 'не показывать')} />
      <Opt title="Открывать вкладку">
        <Seg value={s.defaultTab} onChange={(defaultTab) => update({ defaultTab })}
          options={[['last', 'Последнюю'], ['owl', 'Owl Smile'], ['bttv', 'BetterTTV']]} />
      </Opt>
    </section>
  );
}

// ——— Предпросмотр ———

const svgUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
const SAMPLE_EMOTE = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text x="16" y="27" font-size="26" text-anchor="middle">🦉</text></svg>`);
const SAMPLE_BADGE = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><rect width="18" height="18" rx="4" fill="#9147ff"/><text x="9" y="14" font-size="12" text-anchor="middle" fill="#fff">★</text></svg>`);

/** Данные для предпросмотра: настоящие смайлы, иконка и эффект из кэша, а если их нет — образцы. */
function previewData(base: RenderData, platform: Platform): { data: RenderData; codes: string[] } {
  const data: RenderData = {
    ...base, emotes: new Map(base.emotes), badges: new Map(base.badges), paints: { ...base.paints }, users: {}, nameplates: new Map(base.nameplates), profiles: {},
  };
  const owl = [...data.emotes].filter(([, e]) => !e.bttv);
  const pick = [
    ...owl.filter(([, e]) => e.animated).slice(0, 1),
    ...owl.filter(([, e]) => !e.animated).slice(0, 2),
    ...[...data.emotes].filter(([, e]) => e.bttv).slice(0, 1),
  ].map(([c]) => c);
  if (!pick.length) {
    data.emotes.set('OwlHi', { src: SAMPLE_EMOTE, w: 32, h: 32, author: 'образец' });
    pick.push('OwlHi');
  }
  let badge = [...data.badges.keys()][0];
  if (!badge) {
    badge = 'sample';
    data.badges.set(badge, { src: SAMPLE_BADGE, title: 'Образец иконки' });
  }
  let paint = Object.keys(data.paints)[0];
  if (!paint) {
    paint = 'sample';
    data.paints[paint] = { id: paint, title: 'Образец', preset: 'shimmer', colors: ['#ffcc00', '#ff5e00'], speed: 3 };
  }
  let plate = [...data.nameplates.keys()][0];
  if (!plate) {
    plate = 'sample';
    data.nameplates.set(plate, plateView({
      title: 'Образец', kind: 'pattern', pattern: 'lightning', colors: ['#bf94ff'], glow: 0.6, opacity: 0.6, anim: 'slide', speed: 6, fade: true,
      alt: { color: '#00e5ff' },
    }, undefined)!);
  }
  data.users = { [`${platform}:owl_viewer`]: { badges: [badge], paint } };
  data.profiles = { [`${platform}:owl_viewer`]: { nameplate: plate } };
  data.version = `preview-${Math.random()}`;
  return { data, codes: pick };
}

/** Сообщение в разметке Twitch (её понимает twitchAdapter). Только DOM API — слова из настроек не попадают в HTML. */
function message(login: string, name: string, color: string, text: string, minutesAgo: number): HTMLElement {
  const msg = document.createElement('div');
  msg.className = 'chat-line__message';
  msg.dataset.aUser = login;
  msg.dataset.owlTs = String(Date.now() - minutesAgo * 60_000);
  const container = document.createElement('span');
  container.className = 'chat-line__username-container';
  const username = document.createElement('span');
  username.className = 'chat-line__username';
  const display = document.createElement('span');
  display.className = 'chat-author__display-name';
  display.style.color = color;
  display.textContent = name;
  username.append(display);
  container.append(username);
  const colon = document.createElement('span');
  colon.textContent = ': ';
  const body = document.createElement('span');
  body.className = 'text-fragment';
  body.dataset.aTarget = 'chat-message-text';
  body.textContent = text;
  msg.append(container, colon, body);
  return msg;
}

function sampleChat(s: Settings, platform: Platform, codes: string[]): HTMLElement[] {
  const [e1, e2 = e1, e3 = e2, e4 = e1] = codes;
  const me = s.myNicks[platform];
  const out = [
    message('owl_viewer', 'OwlViewer', '#bf94ff', `всем привет ${e1} ${e2}`, 7),
    message('anna_m', 'Anna_M', '#00c8af', `${me ? `@${me}` : '@вы'} смотри ${e3}`, 6),
    message('nightbot', 'Nightbot', '#8a8a8a', 'Подписывайтесь на канал! Команды: !discord !tg', 5),
  ];
  // Скрытый зритель — отдельным сообщением, если это не один из образцов выше
  const hidden = s.hideUsers.find((u) => !['owl_viewer', 'anna_m', 'nightbot'].includes(u));
  if (hidden) out.push(message(hidden, hidden, '#ff7f50', 'сообщение от скрытого зрителя', 4));
  if (s.hideWords[0]) out.push(message('chatter', 'Chatter', '#1e90ff', `кто-то написал: ${s.hideWords[0]}`, 3));
  if (s.highlightWords[0]) out.push(message('viewer2', 'Viewer2', '#ff69b4', `а тут — ${s.highlightWords[0]}`, 2));
  out.push(message('lurker', 'Lurker', '#9acd32', `обычное сообщение ${e4}`, 1));
  out.push(message('fan_42', 'fan_42', '#ffb74d', `${e1} ${e1} ${e1}`, 0));
  return out;
}

function Preview({ s, dataRef }: { s: Settings; dataRef: { current: RenderData | null } }) {
  const box = useRef<HTMLDivElement>(null);
  const [platform, setPlatform] = useState<Platform>('twitch');
  const [base, setBase] = useState<RenderData | null>(null);

  useEffect(() => {
    const load = () => void loadRenderData(null, s).then(setBase);
    load();
    const onChange = (ch: Record<string, unknown>) => {
      if (K_INDEX in ch || K_BTTV_GLOBAL in ch) load();
    };
    browser.storage.local.onChanged.addListener(onChange);
    return () => browser.storage.local.onChanged.removeListener(onChange);
  }, [s.owlEmotes, s.bttvEmotes]);

  useEffect(() => {
    const el = box.current;
    if (!el || !base) return;
    const { data, codes } = previewData(base, platform);
    dataRef.current = data;
    // Разметка Twitch, но поведение площадки из переключателя (у VK своё время у сообщений)
    const adapter: ChatAdapter = { ...twitchAdapter, platform, ownTimestamps: platform === 'vk' };
    applySettings(el, s, platform);
    el.classList.toggle('owl-vk', platform === 'vk');
    el.replaceChildren(...sampleChat(s, platform, codes));
    new ChatRenderer(adapter, data, s).processTree(el);
  }, [s, base, platform]);

  return (
    <>
      <div class="preview-head">
        <h2 class="grow">Предпросмотр</h2>
        <Seg value={platform} onChange={setPlatform} options={PLATFORMS.map((p) => [p, PLATFORM_TITLES[p]] as [Platform, string])} />
      </div>
      <div class="preview-chat" ref={box} />
      {!isActive(s, platform) && <div class="muted small warn">Owl Smile на {PLATFORM_TITLES[platform]} выключен — чат как без расширения.</div>}
      <div class="muted small">Наведите на смайл — так он выглядит в чате с вашими настройками.</div>
    </>
  );
}

// ——— Страница ———

const SECTIONS = { emotes: 'Смайлы', cosmetics: 'Иконки и ники', messages: 'Сообщения', filters: 'Фильтры', picker: 'Окно смайлов', general: 'Площадки' } as const;
type Section = keyof typeof SECTIONS;

function exportSettings(s: Settings): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'owl-smile-settings.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function App() {
  const [s, update, error] = useSettings();
  const [section, setSection] = useState<Section>('emotes');
  const [note, setNote] = useState('');
  const dataRef = useRef<RenderData | null>(null);
  const settingsRef = useRef<Settings | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  settingsRef.current = s;

  useEffect(() => installHover(() => settingsRef.current ?? DEFAULT_SETTINGS, () => dataRef.current ?? emptyData()), []);

  if (!s) return null;

  const importFile = async (file: File) => {
    try {
      const next = normalizeSettings(JSON.parse(await file.text()));
      update(next);
      setNote('Настройки загружены из файла');
    } catch {
      setNote('Это не файл настроек Owl Smile');
    }
  };

  return (
    <div class="app options">
      <header>
        <h1 class="grow">🦉 Owl Smile — настройки</h1>
        <button class="ghost xs" onClick={() => exportSettings(s)}>Сохранить в файл</button>
        <button class="ghost xs" onClick={() => fileRef.current?.click()}>Загрузить из файла</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) void importFile(f);
          e.currentTarget.value = '';
        }} />
        <button class="ghost xs danger" onClick={() => {
          if (!confirm('Вернуть все настройки по умолчанию?')) return;
          void resetSettings().then(loadSettings).then((d) => {
            update(d);
            setNote('Настройки сброшены');
          });
        }}>Сбросить</button>
      </header>

      <section class={`card master ${s.enabled ? '' : 'off'}`}>
        <Switch label="Owl Smile в чате" checked={s.enabled} onChange={(enabled) => update({ enabled })} />
        <div class="grow">
          <div class="title"><b>{s.enabled ? 'Owl Smile включён' : 'Owl Smile выключен'}</b></div>
          <div class="muted small">
            {s.enabled
              ? 'Смайлы, иконки, эффекты ников и всё, что настроено ниже, видны в чате.'
              : 'Чат выглядит как без расширения: ни смайлов, ни иконок, ни эффектов, ни фильтров. Настройки сохранены.'}
          </div>
        </div>
      </section>
      {(error || note) && <div class={`status ${error ? 'err' : 'ok'}`} style="margin-top:12px">{error || note}</div>}

      <nav class="tabs" style="margin-top:16px">
        {(Object.keys(SECTIONS) as Section[]).map((t) => (
          <button key={t} class={t === section ? 'active' : ''} onClick={() => setSection(t)}>{SECTIONS[t]}</button>
        ))}
      </nav>

      <div class="layout">
        <div class={`stack ${s.enabled ? '' : 'disabled'}`}>
          {section === 'emotes' && <Emotes s={s} update={update} />}
          {section === 'cosmetics' && <Cosmetics s={s} update={update} />}
          {section === 'messages' && <Messages s={s} update={update} />}
          {section === 'filters' && <Filters s={s} update={update} />}
          {section === 'picker' && <Picker s={s} update={update} />}
          {section === 'general' && <General s={s} update={update} />}
        </div>
        <aside class="side">
          <Preview s={s} dataRef={dataRef} />
        </aside>
      </div>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
