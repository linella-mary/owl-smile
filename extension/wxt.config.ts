import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

// Только для тестов: другой git-сервер вместо gitflic.ru (например, локальный).
const testHost = process.env.WXT_GITFLIC_HOST;

export default defineConfig({
  srcDir: 'src',
  // Тестовая сборка не должна перезаписывать рабочую.
  outDir: testHost ? '.output-e2e' : '.output',
  imports: false,
  vite: () => ({
    plugins: [preact()],
    // Зависимости isomorphic-git ищут `global`/`window`, которых нет в сервис-воркере MV3.
    define: { global: 'globalThis' },
  }),
  manifest: {
    name: 'Owl Smile',
    description: 'Свои смайлы, иконки и эффекты ников в чатах Twitch и VK Live',
    permissions: ['storage', 'unlimitedStorage', 'alarms'],
    host_permissions: [
      'https://gitflic.ru/*',
      'https://*.twitch.tv/*',
      'https://live.vkvideo.ru/*',
      ...(testHost ? [`${new URL(testHost).origin}/*`] : []),
    ],
    action: { default_title: 'Owl Smile' },
  },
});
