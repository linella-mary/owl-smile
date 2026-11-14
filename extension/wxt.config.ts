import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

// Только для тестов: другой git-сервер вместо gitflic.ru (например, локальный).
const testHost = process.env.WXT_GITFLIC_HOST;
// Только для тестов: подставной сервер вместо BetterTTV и api.ivr.fi.
const bttvTestHost = process.env.WXT_BTTV_TEST_HOST;

export default defineConfig({
  srcDir: 'src',
  // Тестовая сборка не должна перезаписывать рабочую.
  outDir: testHost || bttvTestHost ? '.output-e2e' : '.output',
  imports: false,
  vite: () => ({
    plugins: [preact()],
    // Зависимости isomorphic-git ищут `global`/`window`, которых нет в сервис-воркере MV3.
    define: { global: 'globalThis' },
  }),
  manifest: {
    name: 'Owl Smile',
    description: 'Свои смайлы, иконки и эффекты ников в чатах Twitch и VK Live',
    permissions: ['storage', 'unlimitedStorage', 'alarms', 'scripting'],
    host_permissions: [
      'https://gitflic.ru/*',
      'https://*.twitch.tv/*',
      'https://live.vkvideo.ru/*',
      // Списки смайлов BetterTTV и id Twitch-канала по логину (картинки грузит страница — им разрешение не нужно)
      'https://api.betterttv.net/*',
      'https://api.ivr.fi/*',
      ...(testHost ? [`${new URL(testHost).origin}/*`] : []),
      ...(bttvTestHost ? [`${new URL(bttvTestHost).origin}/*`] : []),
    ],
    action: { default_title: 'Owl Smile' },
  },
});
