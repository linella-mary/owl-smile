import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { OwlMessage } from '../shared/messages';
import { sync } from '../sync';

const ALARM = 'owl-sync';
const PERIOD_MIN = 15;

export default defineBackground(() => {
  // При запуске браузера и установке/обновлении расширения — синхронизация.
  browser.runtime.onStartup.addListener(() => void sync());
  browser.runtime.onInstalled.addListener(() => void sync(true));

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
