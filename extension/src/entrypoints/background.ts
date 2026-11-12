import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { OwlMessage } from '../shared/messages';
import { sync } from '../sync';

const ALARM = 'owl-sync';
const PERIOD_MIN = 15;

/** Ставит content scripts из манифеста во все открытые подходящие вкладки. */
async function injectIntoOpenTabs(): Promise<void> {
  for (const cs of browser.runtime.getManifest().content_scripts ?? []) {
    if (!cs.matches?.length) continue;
    for (const tab of await browser.tabs.query({ url: cs.matches })) {
      if (tab.id === undefined) continue;
      try {
        if (cs.css?.length) await browser.scripting.insertCSS({ target: { tabId: tab.id }, files: cs.css });
        // Пути берутся из манифеста во время работы — типизированный список WXT о них не знает.
        type ScriptFiles = NonNullable<Extract<Parameters<typeof browser.scripting.executeScript>[0], { files: unknown[] }>['files']>;
        if (cs.js?.length) await browser.scripting.executeScript({ target: { tabId: tab.id }, files: cs.js as ScriptFiles });
      } catch (e) {
        console.warn('[owl] не удалось подключиться к вкладке', tab.url, e);
      }
    }
  }
}

export default defineBackground(() => {
  // При запуске браузера и установке/обновлении расширения — синхронизация.
  browser.runtime.onStartup.addListener(() => void sync());
  browser.runtime.onInstalled.addListener(({ reason }) => {
    void sync(true);
    // После установки/обновления в уже открытых вкладках нашего скрипта нет (или он «осиротел») —
    // ставим сами, чтобы не нужно было обновлять страницу.
    if (reason === 'install' || reason === 'update') void injectIntoOpenTabs();
  });

  // Периодическая синхронизация (будильник может пропасть после перезапуска — пересоздаём).
  void browser.alarms.get(ALARM).then((a) => {
    if (!a) void browser.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN, delayInMinutes: PERIOD_MIN });
  });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM) void sync();
  });

  browser.runtime.onMessage.addListener((msg: OwlMessage, _sender, sendResponse) => {
    if (msg?.type === 'owl:sync') {
      void sync(msg.force ?? true).then(sendResponse);
      return true;
    }
    if (msg?.type === 'owl:open-manage') {
      void browser.tabs.create({ url: browser.runtime.getURL('/manage.html') });
    }
    return undefined;
  });
});
