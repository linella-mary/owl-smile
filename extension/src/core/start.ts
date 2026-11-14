import { browser } from 'wxt/browser';
import type { ChatAdapter } from '../platforms/types';
import {
  K_BTTV_GLOBAL,
  K_BTTV_SETTING,
  bttvChannelKey,
  bttvImg,
  bttvSrcset,
  twitchChannelFromUrl,
  type BttvChannel,
  type BttvEmote,
  type BttvGlobal,
} from '../shared/bttv';
import { K_INDEX, getImages, type LocalIndex } from '../shared/cache';
import type { OwlMessage } from '../shared/messages';
import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, type Settings } from '../shared/settings';
import { applySettings } from './apply-settings';
import { plateView } from './paint';
import { installHover } from './hover';
import { EmotePicker, installTabCompletion } from './picker';
import { ChatLog } from './chat-log';
import { installProfileCards } from './profile-card';
import { installTwitchCards } from './twitch-card';
import { ChatRenderer, emptyData, type BttvView, type RenderData } from './renderer';

/**
 * Загружает данные из локального кэша (без сети): база Owl Smile и списки BetterTTV —
 * глобальные и канала `bttvLogin` (null — смайлов канала нет).
 * Источники смайлов, выключенные в настройках, не загружаются.
 */
export async function loadRenderData(bttvLogin: string | null = null, settings: Settings = DEFAULT_SETTINGS): Promise<RenderData> {
  const chKey = bttvLogin ? bttvChannelKey(bttvLogin) : null;
  const got = await browser.storage.local.get([K_INDEX, K_BTTV_GLOBAL, ...(chKey ? [chKey] : [])]);
  const idx = got[K_INDEX] as LocalIndex | undefined;
  const global = got[K_BTTV_GLOBAL] as BttvGlobal | undefined;
  const channel = chKey ? (got[chKey] as BttvChannel | undefined) : undefined;

  const data = emptyData();
  if (idx) {
    const plates = idx.nameplates ?? {};
    const oids = new Set([
      ...Object.values(idx.emotes).map((e) => e.img),
      ...Object.values(idx.badges).map((b) => b.img),
      ...Object.values(plates).flatMap((p) => (p.img ? [p.img] : [])),
    ]);
    const images = await getImages([...oids]);
    data.paints = idx.paints;
    data.users = idx.users;
    data.profiles = idx.profiles ?? {};
    for (const [id, p] of Object.entries(plates)) {
      const view = plateView(p, p.img ? images[p.img] : undefined);
      if (view) data.nameplates.set(id, view);
    }
    for (const [code, e] of settings.owlEmotes ? Object.entries(idx.emotes) : []) {
      const src = images[e.img];
      if (src) data.emotes.set(code, { src, w: e.w, h: e.h, animated: e.animated, author: e.author, createdAt: e.createdAt });
    }
    for (const [code, e] of Object.entries(idx.emotes)) {
      const who = e.author.trim().toLowerCase();
      data.emotesByAuthor.set(who, [...(data.emotesByAuthor.get(who) ?? []), code]);
    }
    for (const [id, b] of Object.entries(idx.badges)) {
      const src = images[b.img];
      if (src) data.badges.set(id, { src, title: b.title, description: b.description });
    }
  }

  // BetterTTV: смайлы канала важнее глобальных, Owl Smile важнее обоих
  /** channelName — смайлы канала: у своих смайлов канала автор — сам канал. */
  const addBttv = (list: BttvEmote[] | undefined, channelName?: string): string[] => {
    const codes: string[] = [];
    for (const e of settings.bttvEmotes ? (list ?? []) : []) {
      if (data.emotes.has(e.code)) continue;
      data.emotes.set(e.code, {
        src: bttvImg(e.id, 1), srcset: bttvSrcset(e.id), w: e.w ?? 28, h: e.h ?? 28, bttv: true, animated: e.animated,
        author: e.by ?? channelName, channel: channelName,
      });
      codes.push(e.code);
    }
    return codes;
  };
  const view: BttvView = { global: [], channel: null };
  if (bttvLogin) {
    const codes = addBttv(channel?.emotes, channel?.name ?? bttvLogin);
    const state = !channel ? 'loading' : channel.missing ? 'missing' : channel.error && !channel.at ? 'error' : 'ok';
    view.channel = { login: bttvLogin, name: channel?.name ?? bttvLogin, codes, state, error: channel?.error };
  }
  view.global = addBttv(global?.emotes);
  data.bttv = view;
  data.version = [idx?.head ?? '', global?.at ?? 0, bttvLogin ?? '', channel?.at ?? 0].join('|');
  return data;
}

/** Чьи смайлы BetterTTV показывать: на Twitch — открытого канала, на VK Live — канала из настроек. */
async function currentBttvLogin(adapter: ChatAdapter): Promise<string | null> {
  if (adapter.platform === 'twitch') return twitchChannelFromUrl(location.href);
  return ((await browser.storage.local.get(K_BTTV_SETTING))[K_BTTV_SETTING] as string | undefined) ?? null;
}

/** Запуск на странице площадки: первичный проход, слежение за чатом, обновление при синхронизации. */
export async function startOwl(adapter: ChatAdapter): Promise<{ renderer: ChatRenderer; data: () => RenderData }> {
  // Стили под вёрстку площадки (style.css: .owl-vk …)
  const html = document.documentElement;
  html.classList.add(`owl-${adapter.platform}`);
  let settings = await loadSettings();
  applySettings(html, settings, adapter.platform);
  let login = await currentBttvLogin(adapter);
  let data = await loadRenderData(login, settings);
  const log = new ChatLog();
  const renderer = new ChatRenderer(adapter, data, settings, log);
  renderer.processTree(document);

  // Фоновый скрипт обновит списки BetterTTV, если они устарели; новые придут через storage.onChanged
  const askBttv = () => {
    browser.runtime.sendMessage({ type: 'owl:bttv', login } satisfies OwlMessage).catch(() => {});
  };
  askBttv();

  let loadSeq = 0;
  const reload = () => {
    const seq = ++loadSeq;
    void loadRenderData(login, settings).then((d) => {
      if (seq !== loadSeq) return; // пока грузили, пришли данные новее
      data = d;
      renderer.setData(d);
      renderer.processTree(document);
      picker.refresh();
    });
  };
  const switchChannel = (next: string | null) => {
    if (next === login) return;
    login = next;
    askBttv();
    reload();
  };

  const picker = new EmotePicker(adapter, () => data, () => settings);
  picker.ensureButton();
  const removeTab = installTabCompletion(adapter, () => data, () => settings);
  const removeHover = installHover(() => settings, () => data);
  const removeCards =
    adapter.profileMode === 'augment'
      ? installTwitchCards(adapter, () => data, () => settings, log)
      : installProfileCards(adapter, () => data, () => settings, log);

  // Личные настройки поменялись (на странице настроек, в окне расширения, горячей клавишей):
  // возвращаем чат к исходному виду и рисуем заново — так снимается и то, что теперь выключено.
  const removeSettings = onSettingsChanged((next) => {
    const sourcesChanged = next.owlEmotes !== settings.owlEmotes || next.bttvEmotes !== settings.bttvEmotes;
    settings = next;
    applySettings(html, settings, adapter.platform);
    renderer.reset(document);
    renderer.setSettings(settings);
    picker.close();
    picker.ensureButton();
    if (sourcesChanged) reload();
    else renderer.processTree(document);
  });

  const sel = adapter.messageSelector;
  let href = location.href;
  const observer = new MutationObserver((mutations) => {
    // Расширение перезагрузили/обновили — этот экземпляр скрипта «осиротел»: выключаемся,
    // новый экземпляр ставит фоновый скрипт (см. background.ts).
    if (!browser.runtime?.id) {
      observer.disconnect();
      removeTab();
      removeHover();
      removeCards();
      removeSettings();
      picker.dispose();
      return;
    }
    // Twitch переходит между каналами без перезагрузки страницы
    if (location.href !== href) {
      href = location.href;
      if (adapter.platform === 'twitch') switchChannel(twitchChannelFromUrl(href));
    }
    picker.ensureButton();
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n instanceof HTMLElement && /\bowl-/.test(n.className)) continue;
        const el = n instanceof Element ? n : n.parentElement;
        if (!el) continue;
        const msg = el.closest(sel);
        // live: новое сообщение (а не изменение внутри старого) — ему ставится время
        if (msg) renderer.processMessage(msg, true, msg === n);
        else if (n instanceof Element) renderer.processTree(n, true);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  browser.storage.local.onChanged.addListener((changes) => {
    if (adapter.platform !== 'twitch' && K_BTTV_SETTING in changes) {
      switchChannel((changes[K_BTTV_SETTING]!.newValue as string | undefined) ?? null);
      return;
    }
    if (K_INDEX in changes || K_BTTV_GLOBAL in changes || (login && bttvChannelKey(login) in changes)) reload();
  });

  return { renderer, data: () => data };
}
