/** Минимальный клиент REST API GitFlic для релизов (личный API-токен). */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.gitflic.ru';

export interface ReleaseFile {
  name: string;
  /** Ссылка, по которой файл скачивается без входа на GitFlic. */
  downloadUrl: string;
}

export class GitflicApi {
  constructor(
    private readonly token: string,
    private readonly owner: string,
    private readonly project: string,
  ) {}

  private get base() {
    return `/project/${this.owner}/${this.project}/release`;
  }

  private async call(method: string, url: string, body?: BodyInit, json = true): Promise<any> {
    const res = await fetch(API + url, {
      method,
      headers: { Authorization: `token ${this.token}`, ...(json && body ? { 'Content-Type': 'application/json' } : {}) },
      body,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`GitFlic API ${method} ${url} → ${res.status}: ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : null;
  }

  /** Создаёт релиз для существующего тега. Возвращает id релиза. */
  async createRelease(opts: { tag: string; title: string; description: string; preRelease?: boolean }): Promise<string> {
    const r = await this.call(
      'POST',
      this.base,
      JSON.stringify({
        title: opts.title,
        description: opts.description,
        tagName: opts.tag,
        preRelease: opts.preRelease ?? false,
        attachProjectArchive: false,
      }),
    );
    const id: string | undefined = r?.id ?? r?.uuid;
    if (!id) throw new Error(`Не понял ответ API при создании релиза: ${JSON.stringify(r).slice(0, 300)}`);
    return id;
  }

  async uploadFile(releaseId: string, filePath: string): Promise<void> {
    const form = new FormData();
    const name = path.basename(filePath);
    form.append('files', new Blob([fs.readFileSync(filePath)], { type: 'application/zip' }), name);
    await this.call('POST', `${this.base}/${releaseId}/file`, form, false);
  }

  /** Файлы релиза со ссылками для скачивания без входа. */
  async files(releaseId: string): Promise<ReleaseFile[]> {
    const list = await this.call('GET', `${this.base}?page=0&size=100`);
    const rel = (list?._embedded?.releaseTagModelList ?? []).find((r: { id: string }) => r.id === releaseId);
    return (rel?.attachmentFiles ?? []).map((f: { name: string; link: string }) => ({
      name: f.name,
      downloadUrl: `https://gitflic.ru${this.base}/${releaseId}/${f.link.split('/').pop()}/download`,
    }));
  }

  async deleteRelease(releaseId: string): Promise<void> {
    await this.call('DELETE', `${this.base}/${releaseId}`);
  }
}
