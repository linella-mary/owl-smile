/**
 * Тестовая сборка плагина OBS без релиза: текущий коммит → GitHub → архив в .output/obs-plugin/.
 *
 *   npm run obs:plugin
 *
 * Нужны GITHUB_TOKEN и GITHUB_REPO в .env (см. scripts/github.ts). Незакоммиченные изменения
 * в сборку не попадают — собирается последний коммит.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildObsPlugin, GithubBuild } from './github';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const root = path.resolve('..');
const git = (...args: string[]) =>
  execFileSync('git', ['-c', `safe.directory=${root.replace(/\\/g, '/')}`, ...args], { cwd: root, encoding: 'utf8' }).trim();

async function main() {
  const gh = GithubBuild.fromEnv();
  if (!gh) throw new Error('Нет GITHUB_TOKEN или GITHUB_REPO в extension/.env');
  if (git('status', '--porcelain', '--untracked-files=no')) console.log('• Есть незакоммиченные изменения — они в сборку не попадут');
  const sha = git('rev-parse', 'HEAD');
  const zip = await buildObsPlugin(gh, root, sha, path.resolve('.output/obs-plugin'));
  if (!zip) process.exit(1);
}

main().catch((e) => {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
