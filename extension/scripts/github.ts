/**
 * GitHub как сборщик плагина OBS (код и релизы живут на GitFlic).
 * Без gh: git push с заголовком авторизации и REST API через fetch.
 *
 * Нужны в .env: GITHUB_TOKEN (fine-grained, только на этот репозиторий:
 * Contents и Workflows — чтение и запись, Actions — чтение) и GITHUB_REPO=<логин>/<репозиторий>.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';

const API = 'https://api.github.com';
const WORKFLOW = 'obs-plugin.yml';
const ARTIFACT = 'owl-smile-obs';

export interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
}

export class GithubBuild {
  constructor(
    private readonly token: string,
    private readonly repo: string,
  ) {}

  static fromEnv(): GithubBuild | null {
    const token = process.env.GITHUB_TOKEN ?? '';
    const repo = process.env.GITHUB_REPO ?? '';
    if (!token || !repo) return null;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_REPO — в формате логин/репозиторий');
    return new GithubBuild(token, repo);
  }

  private async call(url: string): Promise<any> {
    const res = await fetch(url.startsWith('http') ? url : API + url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'owl-smile-release',
      },
    });
    if (!res.ok) throw new Error(`GitHub ${url} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }

  /** Отправляет текущий HEAD в master (и теги) — на GitHub это запускает сборку плагина. */
  push(root: string, refs: string[] = []): void {
    const auth = Buffer.from(`x-access-token:${this.token}`).toString('base64');
    execFileSync(
      'git',
      [
        '-c', `safe.directory=${root.replace(/\\/g, '/')}`,
        '-c', `http.extraHeader=Authorization: Basic ${auth}`,
        '-c', 'credential.helper=',
        'push', '--force', `https://github.com/${this.repo}.git`, 'HEAD:refs/heads/master', ...refs,
      ],
      { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] },
    );
  }

  /** Ждёт сборку плагина для коммита `sha` (сначала её появления, затем окончания). */
  async waitForRun(sha: string, timeoutMs = 40 * 60_000, onTick?: (run: WorkflowRun | null) => void): Promise<WorkflowRun> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const runs = (await this.call(`/repos/${this.repo}/actions/workflows/${WORKFLOW}/runs?head_sha=${sha}&per_page=5`)).workflow_runs as WorkflowRun[];
      const run = runs[0] ?? null;
      onTick?.(run);
      if (run?.status === 'completed') return run;
      if (Date.now() > deadline) throw new Error(run ? `сборка не закончилась за отведённое время: ${run.html_url}` : 'сборка на GitHub так и не началась');
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }

  /** Скачивает архив плагина из сборки в каталог `outDir`. Возвращает путь к zip. */
  async downloadPlugin(runId: number, outDir: string): Promise<string> {
    const list = (await this.call(`/repos/${this.repo}/actions/runs/${runId}/artifacts`)).artifacts as { name: string; archive_download_url: string }[];
    const art = list.find((a) => a.name === ARTIFACT);
    if (!art) throw new Error(`в сборке нет артефакта ${ARTIFACT}`);
    // Ссылка перенаправляет на подписанный адрес хранилища; fetch не передаёт туда наш токен
    const res = await fetch(art.archive_download_url, { headers: { Authorization: `Bearer ${this.token}`, 'User-Agent': 'owl-smile-release' } });
    if (!res.ok) throw new Error(`не удалось скачать артефакт: ${res.status}`);
    // GitHub упаковывает артефакт в свой zip — внутри наш owl-smile-obs-X.Y.Z.zip
    const outer = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const name = Object.keys(outer).find((n) => /^owl-smile-obs-.+\.zip$/.test(n));
    if (!name) throw new Error('в артефакте нет owl-smile-obs-*.zip');
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, name);
    fs.writeFileSync(out, outer[name]!);
    return out;
  }
}

/** Отправить, дождаться и скачать: путь к архиву плагина или null с понятной причиной в консоли. */
export async function buildObsPlugin(gh: GithubBuild, root: string, sha: string, outDir: string, refs: string[] = []): Promise<string | null> {
  console.log('• Плагин OBS: отправка кода на GitHub…');
  gh.push(root, refs);
  let last = '';
  const run = await gh.waitForRun(sha, undefined, (r) => {
    const state = r ? `${r.status}${r.conclusion ? ` (${r.conclusion})` : ''}` : 'ждём запуска';
    if (state !== last) console.log(`  сборка: ${state}${r ? ` — ${r.html_url}` : ''}`);
    last = state;
  });
  if (run.conclusion !== 'success') {
    console.log(`✖ Сборка плагина OBS не удалась: ${run.html_url}`);
    return null;
  }
  const zip = await gh.downloadPlugin(run.id, outDir);
  console.log(`✔ Плагин OBS: ${zip}`);
  return zip;
}
