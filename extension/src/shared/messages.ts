import { browser } from 'wxt/browser';
import type { SyncResult } from '../sync';

export type OwlMessage = { type: 'owl:sync'; force?: boolean } | { type: 'owl:open-manage' };

export function requestSync(force = true): Promise<SyncResult> {
  return browser.runtime.sendMessage({ type: 'owl:sync', force } satisfies OwlMessage);
}
