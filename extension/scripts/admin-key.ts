/**
 * Личный ключ админа для страницы загрузки.
 *
 *   npm run admin:key -- <ник админа>
 *
 * Печатает ключ (его хранит только админ) и строки для .env (их можно публиковать: в сборку
 * попадает лишь отпечаток SHA-256). После правки .env — пересобрать и выпустить расширение.
 */
import { createHash, randomBytes } from 'node:crypto';

const nick = process.argv.slice(2).join(' ').trim();
if (!nick) {
  console.error('Укажите ник админа: npm run admin:key -- <ник>');
  process.exit(1);
}
// 32 случайных байта: сборка общедоступна, и короткий ключ подобрали бы перебором по отпечатку
const key = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(key).digest('hex');
console.log(`Ключ админа (сохраните, никому не пересылайте; в .env его НЕ вписывать):\n\n  ${key}\n`);
console.log(`Строки для extension/.env:\n\nWXT_ADMIN_NICK=${nick}\nWXT_ADMIN_KEY_SHA256=${hash}\n`);
