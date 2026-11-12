import '../core/style.css';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { startOwl } from '../core/start';
import { twitchAdapter } from '../platforms/twitch';

export default defineContentScript({
  matches: ['https://*.twitch.tv/*'],
  runAt: 'document_idle',
  main() {
    void startOwl(twitchAdapter);
  },
});
