import { browser } from 'wxt/browser';
import type { ChatAdapter } from '../platforms/types';
import type { LocalProfile } from '../shared/cache';
import { HEX_COLOR_RE, PLATFORM_TITLES, isBirthdayToday, isSafeUrl, isValidNick, isValidTimeZone, userKey, type Platform } from '../shared/ids';
import { loadSettings, saveSettings, type Settings } from '../shared/settings';
import type { ChatLog } from './chat-log';
import { applyNameplate, applyPaint } from './paint';
import { insertIntoChat } from './picker';
import type { RenderData } from './renderer';
import { socialMark } from './socials';
import { tokenize } from './tokenizer';

/**
 * Содержимое профиля Owl Smile — общее для карточки VK (profile-card.ts) и блока в карточке Twitch
 * (twitch-card.ts). Только DOM API и textContent: данные из репозитория в HTML не попадают.
 */

const K_NOTES = 'owl:notes';
const MAX_NOTE = 500;
const MAX_NOTES = 500;
const MAX_HIS_EMOTES = 12;

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export const PROFILE_CSS = `
.label { color: #adadb8; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
.sections { display: flex; flex-direction: column; gap: 10px; }
.about { white-space: pre-line; word-break: break-word; }
.facts { display: flex; flex-direction: column; gap: 3px; color: #dedee3; font-size: 12px; }
.owl-user { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: #d2b8ff; background: #9147ff2e; border: 1px solid #9147ff88; border-radius: 4px; padding: 1px 6px; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { font-size: 11px; background: #ffffff14; border-radius: 10px; padding: 2px 8px; }
.badges { display: flex; flex-direction: column; gap: 6px; }
.badge { display: flex; align-items: flex-start; gap: 8px; }
.badge img { width: 28px; height: 28px; object-fit: contain; flex-shrink: 0; }
.badge b { display: block; font-size: 13px; }
.desc { color: #adadb8; font-size: 12px; white-space: pre-line; word-break: break-word; }
.wears { display: flex; flex-direction: column; gap: 4px; }
.wear { display: flex; align-items: center; gap: 8px; }
.wear .sample { isolation: isolate; font-weight: 700; }
.links { display: flex; flex-direction: column; gap: 4px; }
.link { display: flex; align-items: center; gap: 6px; }
.mark { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 16px; padding: 0 3px; border-radius: 3px; font-size: 9px; font-weight: 800; color: #fff; }
a { color: #bf94ff; text-decoration: none; word-break: break-all; }
a:hover { text-decoration: underline; }
.emotes { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.emotes img { height: 28px; max-width: 84px; object-fit: contain; }
.msgs { display: flex; flex-direction: column; gap: 4px; }
.msg { font-size: 12px; word-break: break-word; }
.msg time { color: #adadb8; margin-right: 6px; font-variant-numeric: tabular-nums; }
.msg img { height: 20px; vertical-align: middle; }
.muted { color: #adadb8; font-size: 12px; }
.mine { border-top: 1px solid #3a3a3d; padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
textarea { width: 100%; box-sizing: border-box; min-height: 44px; resize: vertical; background: #0e0e10; color: inherit; border: 1px solid #3a3a3d; border-radius: 6px; padding: 6px 8px; font: inherit; outline: none; }
textarea:focus { border-color: #9147ff; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
button.act { background: transparent; color: #efeff1; border: 1px solid #3a3a3d; border-radius: 6px; padding: 5px 9px; font: inherit; font-size: 12px; cursor: pointer; }
button.act:hover { background: #ffffff14; }
button.act.on { border-color: #9147ff; background: #9147ff2e; }
button.primary { background: #9147ff; border-color: #9147ff; color: #fff; }
button.primary:hover { background: #772ce8; }
details > summary { cursor: pointer; color: #adadb8; font-size: 12px; list-style: none; }
details > summary::-webkit-details-marker { display: none; }
details > summary::before { content: '▸ '; }
details[open] > summary::before { content: '▾ '; }
details[open] > summary { margin-bottom: 6px; }
`;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Смайлы Owl Smile, которые загрузил этот зритель (по нику загрузившего: логин или ник как в чате). */
export function hisEmotes(data: RenderData, login: string, display: string): string[] {
  const out = new Set<string>();
  for (const who of [login, display.toLowerCase()]) for (const c of data.emotesByAuthor.get(who) ?? []) out.add(c);
  return [...out].sort();
}

/** Пользователь Owl Smile — есть запись в общей базе: иконки, эффект, профиль, подложка или свои смайлы. */
export function isOwlUser(data: RenderData, key: string, login: string, display = login): boolean {
  const u = data.users[key];
  const p = data.profiles[key];
  return Boolean(
    (u && (u.badges.length || u.paint)) || (p && Object.keys(p).length) || hisEmotes(data, login, display).length,
  );
}

/** «В Owl Smile с …»: самая ранняя из дат — первая запись профиля и загрузка его смайлов. */
export function owlSince(data: RenderData, profile: LocalProfile, codes: string[]): Date | null {
  const dates = [profile.since, ...codes.map((c) => data.emotes.get(c)?.createdAt)]
    .map((s) => (s ? new Date(s) : null))
    .filter((d): d is Date => Boolean(d && !Number.isNaN(d.getTime())));
  return dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
}

const time = (ts: number) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export interface ProfileCtx {
  adapter: ChatAdapter;
  /** Ник в нижнем регистре (ключ зрителя). */
  login: string;
  /** Как ник показан в чате. */
  display: string;
  data: RenderData;
  settings: Settings;
  log: ChatLog | null;
  /** Кнопка «Профиль Twitch / VK» (карточка VK — открыть родную карточку площадки). */
  onNative?: () => void;
}

/** Ник с эффектом и подложкой, как в чате (обёртка — слой для подложки). */
export function decoratedName(ctx: ProfileCtx, cls = 'name'): HTMLElement {
  const key = userKey(ctx.adapter.platform, ctx.login);
  const wrap = el('span', 'name-wrap');
  const name = el('span', cls, ctx.display);
  wrap.append(name);
  const paint = ctx.data.users[key]?.paint;
  const plate = ctx.data.profiles[key]?.nameplate;
  if (ctx.settings.paints && paint) applyPaint(name, ctx.data.paints[paint]);
  if (ctx.settings.nameplates && plate) applyNameplate(name, ctx.data.nameplates.get(plate) ?? null);
  return wrap;
}

/** Короткие факты: Пользователь Owl Smile, с какого времени, статус, день рождения, местное время. */
export function factsSection(ctx: ProfileCtx): HTMLElement | null {
  const key = userKey(ctx.adapter.platform, ctx.login);
  const profile = ctx.data.profiles[key] ?? {};
  const owl = isOwlUser(ctx.data, key, ctx.login, ctx.display);
  const box = el('div', 'facts');
  if (owl) {
    const line = el('div');
    line.append(el('span', 'owl-user', '🦉 Пользователь Owl Smile'));
    const since = owlSince(ctx.data, profile, hisEmotes(ctx.data, ctx.login, ctx.display));
    if (since) line.append(document.createTextNode(` · с ${since.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}`));
    box.append(line);
  }
  if (profile.status) box.append(el('div', undefined, `💬 ${profile.status}`));
  if (profile.birthday) {
    const [m, d] = profile.birthday.split('-').map(Number);
    const today = isBirthdayToday(profile.birthday);
    box.append(el('div', undefined, `🎂 ${today ? 'Сегодня день рождения!' : `День рождения ${d} ${MONTHS[m! - 1]}`}`));
  }
  if (profile.timezone && isValidTimeZone(profile.timezone)) {
    const now = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: profile.timezone });
    box.append(el('div', undefined, `🕒 Местное время: ${now} (${profile.timezone.split('/').pop()!.replace(/_/g, ' ')})`));
  }
  return box.childElementCount ? box : null;
}

const languageNames = (() => {
  try {
    return new Intl.DisplayNames(['ru'], { type: 'language' });
  } catch {
    return null;
  }
})();

function section(label: string, ...content: (Node | null)[]): HTMLElement | null {
  const items = content.filter((c): c is Node => Boolean(c));
  if (!items.length) return null;
  const box = el('div');
  box.append(el('div', 'label', label), ...items);
  return box;
}

function emoteImg(data: RenderData, code: string): HTMLImageElement | null {
  const e = data.emotes.get(code);
  if (!e) return null;
  const img = el('img');
  img.src = e.src;
  img.alt = code;
  img.title = code;
  return img;
}

/** Профиль из общей базы: о себе, интересы, языки, иконки, что носит, ссылки, смайлы, другая площадка. */
export function publicSections(ctx: ProfileCtx): HTMLElement[] {
  const { data, settings } = ctx;
  const key = userKey(ctx.adapter.platform, ctx.login);
  const profile: LocalProfile = data.profiles[key] ?? {};
  const user = data.users[key];
  const out: (HTMLElement | null)[] = [];

  if (profile.about) out.push(el('div', 'about', profile.about));

  if (profile.interests?.length || profile.languages?.length) {
    const chips = el('div', 'chips');
    for (const t of profile.interests ?? []) chips.append(el('span', 'chip', `#${t}`));
    for (const l of profile.languages ?? []) chips.append(el('span', 'chip', `🗣 ${languageNames?.of(l) ?? l}`));
    out.push(chips);
  }

  // Иконки: что каждая значит
  const badgeIds = settings.badges ? (user?.badges ?? []).filter((b) => data.badges.has(b)) : [];
  if (badgeIds.length) {
    const list = el('div', 'badges');
    for (const id of badgeIds) {
      const b = data.badges.get(id)!;
      const item = el('div', 'badge');
      const img = el('img');
      img.src = b.src;
      img.alt = '';
      const text = el('div');
      text.append(el('b', undefined, b.title));
      if (b.description) text.append(el('div', 'desc', b.description));
      item.append(img, text);
      list.append(item);
    }
    out.push(section('Иконки', list));
  }

  // Что носит: эффект и подложка — название и образец
  const paint = user?.paint ? data.paints[user.paint] : undefined;
  const plate = profile.nameplate ? data.nameplates.get(profile.nameplate) : undefined;
  if (paint || plate) {
    const list = el('div', 'wears');
    const wear = (kind: string, title: string, apply: (n: HTMLElement) => void) => {
      const row = el('div', 'wear');
      const wrap = el('span');
      const sample = el('span', 'sample', ctx.display);
      wrap.append(sample);
      apply(sample);
      row.append(wrap, el('span', 'muted', `${kind}: ${title}`));
      list.append(row);
    };
    if (paint) wear('эффект', paint.title, (n) => applyPaint(n, paint));
    if (plate) wear('подложка', plate.title, (n) => applyNameplate(n, plate));
    out.push(section('Оформление', list));
  }

  const links = (profile.links ?? []).filter((l) => isSafeUrl(l.url));
  if (links.length) {
    const list = el('div', 'links');
    for (const l of links) {
      const row = el('div', 'link');
      const mark = socialMark(l.url);
      const m = el('span', 'mark', mark?.label ?? '🔗');
      if (mark) {
        m.style.background = mark.color;
        m.title = mark.name;
      }
      const a = el('a', undefined, l.title);
      a.href = l.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
      a.title = l.url;
      row.append(m, a);
      list.append(row);
    }
    out.push(section('Ссылки', list));
  }

  const his = hisEmotes(data, ctx.login, ctx.display);
  const hisShown = his.map((c) => emoteImg(data, c)).filter(Boolean).slice(0, MAX_HIS_EMOTES) as HTMLImageElement[];
  if (his.length) {
    const box = el('div', 'emotes');
    box.append(...hisShown);
    if (his.length > hisShown.length) box.append(el('span', 'muted', `+${his.length - hisShown.length}`));
    out.push(section(`Загрузил(а) смайлов: ${his.length}`, box));
  }

  const favs = (profile.favEmotes ?? []).map((c) => emoteImg(data, c)).filter(Boolean) as HTMLImageElement[];
  if (favs.length) {
    const box = el('div', 'emotes');
    box.append(...favs);
    out.push(section('Любимые смайлы', box));
  }

  if (profile.alsoOn && isValidNick(profile.alsoOn.platform, profile.alsoOn.nick)) {
    const { platform: p, nick } = profile.alsoOn;
    const url = p === 'twitch' ? `https://www.twitch.tv/${nick}` : null;
    let node: HTMLElement;
    if (url) {
      const a = el('a', undefined, nick);
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      node = a;
    } else node = el('span', undefined, nick);
    out.push(section(`Также на ${PLATFORM_TITLES[p as Platform]}`, node));
  }

  return out.filter((x): x is HTMLElement => Boolean(x));
}

/** Сообщения в этом чате (только у себя, из журнала вкладки): число и последние 5, смайлы — картинками. */
export function chatSection(ctx: ProfileCtx): HTMLElement | null {
  if (!ctx.log) return null;
  const { count, last } = ctx.log.get(userKey(ctx.adapter.platform, ctx.login));
  const box = el('div', 'msgs');
  if (!count) {
    box.append(el('div', 'muted', 'Ничего не писал(а) с тех пор, как открыт чат.'));
  } else {
    for (const m of [...last].reverse()) {
      const row = el('div', 'msg');
      if (m.at) row.append(el('time', undefined, time(m.at)));
      const tokens = tokenize(m.text, (c) => ctx.data.emotes.has(c));
      if (!tokens) row.append(document.createTextNode(m.text));
      else for (const t of tokens) row.append(t.type === 'text' ? document.createTextNode(t.value) : (emoteImg(ctx.data, t.code) ?? document.createTextNode(t.code)));
      box.append(row);
    }
  }
  return section(`Сообщений в этом чате: ${count}`, box);
}

/** Только для себя: заметка, подсветить / скрыть, упомянуть, скопировать ник, (профиль площадки). */
export async function mineSection(ctx: ProfileCtx): Promise<HTMLElement> {
  const key = userKey(ctx.adapter.platform, ctx.login);
  const mine = el('div', 'mine');
  mine.append(el('div', 'label', 'Заметка (видна только вам)'));
  const note = el('textarea');
  note.maxLength = MAX_NOTE;
  note.placeholder = 'например: модератор с прошлого стрима';
  const notes = ((await browser.storage.local.get(K_NOTES))[K_NOTES] as Record<string, string> | undefined) ?? {};
  note.value = notes[key] ?? '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  note.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void saveNote(key, note.value), 400);
  });
  mine.append(note);

  const actions = el('div', 'actions');
  const toggle = (label: string, field: 'hideUsers' | 'highlightUsers') => {
    const btn = el('button', 'act', label);
    const paint = (on: boolean) => btn.classList.toggle('on', on);
    paint(ctx.settings[field].includes(ctx.login));
    btn.addEventListener('click', async () => {
      const cur = await loadSettings();
      const on = !cur[field].includes(ctx.login);
      await saveSettings({ [field]: on ? [...cur[field], ctx.login] : cur[field].filter((u) => u !== ctx.login) });
      paint(on);
    });
    return btn;
  };
  // На Twitch упоминают логином, на VK — ником как в чате
  const mentionName = ctx.adapter.platform === 'twitch' ? ctx.login : ctx.display;
  const mention = el('button', 'act', 'Упомянуть');
  mention.title = `Вставить @${mentionName} в поле ввода`;
  mention.addEventListener('click', () => void insertIntoChat(ctx.adapter, `@${mentionName}`));
  const copy = el('button', 'act', 'Скопировать ник');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ctx.display);
      copy.textContent = 'Скопировано ✓';
    } catch {
      copy.textContent = 'Не получилось';
    }
    setTimeout(() => (copy.textContent = 'Скопировать ник'), 1500);
  });
  actions.append(mention, copy, toggle('Подсвечивать', 'highlightUsers'), toggle('Скрывать сообщения', 'hideUsers'));
  if (ctx.onNative) {
    const native = el('button', 'act primary', `Профиль ${PLATFORM_TITLES[ctx.adapter.platform]}`);
    native.title = 'Обычная карточка площадки (или Alt+клик по нику)';
    native.addEventListener('click', ctx.onNative);
    actions.append(native);
  }
  mine.append(actions);
  return mine;
}

/** Цвет шапки из профиля (только #RRGGBB). */
export function accentOf(ctx: ProfileCtx): string | null {
  const a = ctx.data.profiles[userKey(ctx.adapter.platform, ctx.login)]?.accent;
  return a && HEX_COLOR_RE.test(a) ? a : null;
}

/** Личная заметка о зрителе (storage.local). Пустая — удаляется; заметок не больше MAX_NOTES. */
async function saveNote(key: string, text: string): Promise<void> {
  const notes = { ...(((await browser.storage.local.get(K_NOTES))[K_NOTES] as Record<string, string> | undefined) ?? {}) };
  delete notes[key];
  const t = text.trim().slice(0, MAX_NOTE);
  if (t) notes[key] = t;
  const keys = Object.keys(notes);
  // Самые старые (первые вставленные) — вон
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_NOTES))) delete notes[k];
  await browser.storage.local.set({ [K_NOTES]: notes });
}
