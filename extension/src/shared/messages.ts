import { browser } from 'wxt/browser';
import type { SyncResult } from '../sync';

export type OwlMessage =
  | { type: 'owl:sync'; force?: boolean }
  | { type: 'owl:open-manage' }
  /** Вкладка чата открыла канал (или он сменился): обновить смайлы BetterTTV, если устарели. */
  | { type: 'owl:bttv'; login: string | null }
  /** Окно расширения: сохранить Twitch-канал для VK Live (пусто — убрать). */
  | { type: 'owl:bttv-setting'; value: string };

export function requestSync(force = true): Promise<SyncResult> {
  return browser.runtime.sendMessage({ type: 'owl:sync', force } satisfies OwlMessage);
}
