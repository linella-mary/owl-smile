import { browser } from 'wxt/browser';
import type { ChatAdapter } from '../platforms/types';
import { K_INDEX, getImages, getIndex } from '../shared/cache';
import { EmotePicker, installTabCompletion } from './picker';
import { ChatRenderer, emptyData, type RenderData } from './renderer';

/** Загружает данные из локального кэша (без сети). */
export async function loadRenderData(): Promise<RenderData> {
  const idx = await getIndex();
  if (!idx) return emptyData();
  const oids = new Set([...Object.values(idx.emotes).map((e) => e.img), ...Object.values(idx.badges).map((b) => b.img)]);
  const images = await getImages([...oids]);
  const data = emptyData();
  data.version = idx.head;
  data.paints = idx.paints;
  data.users = idx.users;
  for (const [code, e] of Object.entries(idx.emotes)) {
    const src = images[e.img];
    if (src) data.emotes.set(code, { src, w: e.w, h: e.h });
  }
  for (const [id, b] of Object.entries(idx.badges)) {
    const src = images[b.img];
    if (src) data.badges.set(id, { src, title: b.title });
  }
  return data;
}

/** Запуск на странице площадки: первичный проход, слежение за чатом, обновление при синхронизации. */
export async function startOwl(adapter: ChatAdapter): Promise<{ renderer: ChatRenderer; data: () => RenderData }> {
  let data = await loadRenderData();
  const renderer = new ChatRenderer(adapter, data);
  renderer.processTree(document);

  const picker = new EmotePicker(adapter, () => data);
  picker.ensureButton();
  const removeTab = installTabCompletion(adapter, () => data);

  const sel = adapter.messageSelector;
  const observer = new MutationObserver((mutations) => {
    // Расширение перезагрузили/обновили — этот экземпляр скрипта «осиротел»: выключаемся,
    // новый экземпляр ставит фоновый скрипт (см. background.ts).
    if (!browser.runtime?.id) {
      observer.disconnect();
      removeTab();
      picker.dispose();
      return;
    }
    picker.ensureButton();
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n instanceof HTMLElement && /\bowl-/.test(n.className)) continue;
        const el = n instanceof Element ? n : n.parentElement;
        if (!el) continue;
        const msg = el.closest(sel);
        if (msg) renderer.processMessage(msg, true);
        else if (n instanceof Element) renderer.processTree(n);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  browser.storage.local.onChanged.addListener((changes) => {
    if (!(K_INDEX in changes)) return;
    void loadRenderData().then((d) => {
      data = d;
      renderer.setData(d);
      renderer.processTree(document);
    });
  });

  return { renderer, data: () => data };
}
