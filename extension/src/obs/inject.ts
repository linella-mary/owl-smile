import css from '../core/style.css?inline';
import { startOwl } from '../core/start';
import { twitchAdapter } from '../platforms/twitch';
import type { ChatAdapter } from '../platforms/types';
import { vkliveAdapter } from '../platforms/vklive';
import { createBttvSync } from '../shared/bttv';
import { commitIndex, getIndex } from '../shared/cache';
import type { OwlMessage } from '../shared/messages';
import { browser, setMessageHandler } from './browser-shim';
import { base64ToBytes, indexFromZip, zipHead } from './zip-data';

/**
 * Owl Smile внутри доков OBS (плагин owl-smile). Плагин вставляет в страницу чата:
 *   window.__owlConfig = { twitchChannel?: string };   — до бандла, необязательно
 *   <этот бандл>
 *   window.__owlSetData('<zip базы в base64>');         — сразу и при каждом обновлении базы
 * Плагин выполняет это при каждой загрузке страницы, поэтому повторный запуск — ничего не делает.
 */

interface OwlObsWindow {
  __owlStarted?: boolean;
  __owlConfig?: { twitchChannel?: string };
  __owlSetData?: (zipBase64: string) => Promise<void>;
  /** Последние сообщения бандла — смотреть в DevTools, если что-то не так. */
  __owlLog?: string[];
}
const w = window as unknown as OwlObsWindow;

function log(...parts: unknown[]): void {
  const line = parts.map((p) => (p instanceof Error ? p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  (w.__owlLog ??= []).push(`${new Date().toISOString().slice(11, 19)} ${line}`);
  if (w.__owlLog.length > 200) w.__owlLog.shift();
  console.info('[owl-obs]', ...parts);
}

function pickAdapter(): ChatAdapter | null {
  const host = location.hostname;
  if (host === 'twitch.tv' || host.endsWith('.twitch.tv')) return twitchAdapter;
  if (host === 'live.vkvideo.ru') return vkliveAdapter;
  return null;
}

const store = {
  get: (keys: string[]) => browser.storage.local.get(keys),
  set: (items: Record<string, unknown>) => browser.storage.local.set(items),
  remove: (keys: string[]) => browser.storage.local.remove(keys),
};
// Списки BetterTTV — прямо со страницы (в OBS нет фонового скрипта расширения)
const bttv = createBttvSync({ store, fetch: (...args) => fetch(...args) });

setMessageHandler(async (raw) => {
  const msg = raw as OwlMessage;
  if (msg?.type === 'owl:bttv') {
    void bttv.refreshGlobal().catch((e: unknown) => log('BetterTTV:', e));
    if (msg.login) void bttv.refreshChannel(msg.login).catch((e: unknown) => log('BetterTTV канала:', e));
    return undefined;
  }
  if (msg?.type === 'owl:bttv-setting') return bttv.setSettingChannel(msg.value);
  // owl:sync и owl:open-manage — дело плагина и браузера, в доке их нет
  return undefined;
});

let applying: Promise<void> = Promise.resolve();

/** Новая база из плагина. Одинаковый архив повторно не разбирается. */
function setData(zipBase64: string): Promise<void> {
  applying = applying.then(async () => {
    try {
      const zip = base64ToBytes(zipBase64);
      const head = await zipHead(zip);
      if ((await getIndex())?.head === head) return;
      const { index, images, problems } = await indexFromZip(zip, head);
      if (problems.length) log('пропущены невалидные файлы:', problems);
      await commitIndex(index, images, new Set(Object.keys(images)));
      log(`база ${head}: смайлов ${Object.keys(index.emotes).length}, иконок ${Object.keys(index.badges).length}`);
    } catch (e) {
      log('не удалось разобрать базу:', e);
    }
  });
  return applying;
}

async function main(): Promise<void> {
  if (w.__owlStarted) return;
  const adapter = pickAdapter();
  if (!adapter) return;
  w.__owlStarted = true;
  w.__owlSetData = setData;

  const style = document.createElement('style');
  style.dataset.owl = 'obs';
  style.textContent = css;
  (document.head ?? document.documentElement).append(style);

  // На VK Live смайлы BetterTTV берутся с Twitch-канала стримера (его вписывают в настройках плагина)
  const twitchChannel = w.__owlConfig?.twitchChannel?.trim();
  if (adapter.platform === 'vk' && twitchChannel) {
    void bttv.setSettingChannel(twitchChannel).catch((e: unknown) => log('BetterTTV канал:', e));
  }

  await startOwl(adapter);
  log(`запущен на ${location.hostname}`);
}

main().catch((e: unknown) => log('ошибка запуска:', e));
