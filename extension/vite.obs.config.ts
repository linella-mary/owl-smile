import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

/**
 * Бандл для доков OBS (плагин obs-plugin/): один файл owl-obs.js, который плагин
 * выполняет на страницах чата Twitch и VK Live. API расширений там нет —
 * `wxt/browser` подменяется на src/obs/browser-shim.ts.
 *
 *   npm run build:obs  →  .output/obs/owl-obs.js
 */
export default defineConfig({
  plugins: [preact()],
  define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
  resolve: {
    alias: { 'wxt/browser': fileURLToPath(new URL('./src/obs/browser-shim.ts', import.meta.url)) },
  },
  build: {
    lib: { entry: 'src/obs/inject.ts', formats: ['iife'], name: 'OwlSmileObs', fileName: () => 'owl-obs.js' },
    outDir: '.output/obs',
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    sourcemap: false,
  },
});
