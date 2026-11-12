/**
 * Проверка API релизов GitFlic без выпуска новой версии:
 * пре-релиз на существующем теге → загрузка zip → скачивание без входа → удаление пре-релиза.
 *   npm run check:release-api -- v0.1.0 .output/owl-smile-0.1.0.zip
 */
import fs from 'node:fs';
import { GitflicApi } from './gitflic-api';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const [tag, zip] = process.argv.slice(2);
const api = new GitflicApi(process.env.GITFLIC_API_TOKEN ?? '', process.env.WXT_GITFLIC_OWNER ?? '', process.env.GITFLIC_CODE_REPO ?? '');

async function main() {
  if (!tag || !zip || !fs.existsSync(zip)) throw new Error('Укажите тег без релиза и путь к zip');
  const id = await api.createRelease({ tag, title: 'Проверка API (будет удалён)', description: 'Автоматическая проверка', preRelease: true });
  console.log(`✔ пре-релиз создан: ${id}`);
  try {
    await api.uploadFile(id, zip);
    const files = await api.files(id);
    console.log(`✔ файл прикреплён: ${files.map((f) => f.name).join(', ')}`);
    const res = await fetch(files[0]!.downloadUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const body = Buffer.from(await res.arrayBuffer());
    const same = body.equals(fs.readFileSync(zip));
    console.log(`${same ? '✔' : '✖'} скачивание без входа: ${res.status}, ${body.length} байт, ${same ? 'совпадает' : 'НЕ совпадает'}`);
    if (!same) process.exitCode = 1;
  } finally {
    await api.deleteRelease(id);
    console.log('✔ пре-релиз удалён');
  }
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
