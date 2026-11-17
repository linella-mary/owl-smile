/**
 * npm test: vitest из рабочей папки с заглавной буквой диска.
 * Windows: если проект открыт как «d:\…» (так его открывает VS Code), vitest загружает свой модуль дважды —
 * по «d:» и по «D:», — и любой файл тестов падает на describe с «Cannot read properties of undefined
 * (reading 'config')». Настройка в vitest.config.ts не помогает: к её чтению модуль уже загружен.
 * Буква диска — любая; на Linux и macOS путь не меняется.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const cwd = process.cwd().replace(/^[a-z](?=:)/, (d) => d.toUpperCase());
// И путь к vitest — от той же папки: по пути к файлу node решает, какой это модуль
const bin = path.join(cwd, 'node_modules', 'vitest', 'vitest.mjs');
const res = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { cwd, stdio: 'inherit' });
process.exit(res.status ?? 1);
