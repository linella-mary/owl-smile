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
  // Исходники для проверки Mozilla (npm run zip:firefox → *-sources.zip): без секретов и сборок
  zip: {
    excludeSources: ['.env', '.env.*', '.output/**', '.output-e2e/**', '.wxt/**', '.spike/**', 'test-results/**', '**/*.log'],
  },
  // Firefox: постоянный id нужен для подписи Mozilla и storage.sync. Менять нельзя — обновления не встанут.
  // Хуком, а не функцией в manifest: с функцией не запускались тесты (плагин WXT для vitest).
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      if (wxt.config.browser !== 'firefox') return;
      manifest.browser_specific_settings = {
        gecko: {
          id: 'owl-smile@gitflic.ru',
          // 140 — ESR; с неё же Firefox понимает data_collection_permissions и popover для окна смайлов
          strict_min_version: '140.0',
          // Расширение ничего не собирает: в общую базу уходит только то, что человек сам загрузил
          data_collection_permissions: { required: ['none'] },
        },
      } as typeof manifest.browser_specific_settings;
    },
  },
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
    commands: {
      'toggle-owl': {
        suggested_key: { default: 'Alt+Shift+O' },
        description: 'Включить или выключить Owl Smile в чате',
      },
    },
  },
});
