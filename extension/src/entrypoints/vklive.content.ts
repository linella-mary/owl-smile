import '../core/style.css';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { startOwl } from '../core/start';
import { vkliveAdapter } from '../platforms/vklive';

export default defineContentScript({
  matches: ['https://live.vkvideo.ru/*'],
  runAt: 'document_idle',
  main(ctx) {
    // ctx.onInvalidated — расширение обновили и во вкладку встал новый экземпляр: этот выключается
    void startOwl(vkliveAdapter, (stop) => ctx.onInvalidated(stop));
  },
});
