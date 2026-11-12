import git, { Errors, type HttpClient, type TreeEntry } from 'isomorphic-git';
import type { ZodType } from 'zod';
import { repoUrl, type RepoConfig } from '../shared/config';
import {
  BadgeSchema,
  EmoteSchema,
  MetaSchema,
  PaintSchema,
  PLATFORMS,
  UserSchema,
  isValidNick,
  normalizeNick,
  userKey,
  type Badge,
  type Emote,
  type Paint,
  type UserCosmetics,
} from '../shared/schema';

/** Любой fs, который понимает isomorphic-git (LightningFS в браузере, node:fs в скриптах). */
export type GitFs = Parameters<typeof git.init>[0]['fs'];

/** Снимок данных репозитория на конкретном коммите. */
export interface Snapshot {
  head: string;
  emotes: Record<string, Emote>;
  badges: Record<string, Badge>;
  paints: Record<string, Paint>;
  /** Ключ — "twitch:login" / "vk:nick". */
  users: Record<string, UserCosmetics>;
  /** Путь картинки ("img/....webp") → oid git-блоба. */
  images: Record<string, string>;
  /** Файлы, не прошедшие проверку (пропущены). */
  problems: string[];
}

/** Изменение файла: содержимое или null (удалить). */
export type Changes = Map<string, Uint8Array | null>;

export class ConflictError extends Error {}

const MAX_PUSH_ATTEMPTS = 3;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const jsonBytes = (v: unknown) => enc.encode(JSON.stringify(v, null, 2) + '\n');

/** GitFlic отвечает 401 на POST git-запросы без User-Agent (а http/node isomorphic-git его не ставит). */
export const GIT_USER_AGENT = 'git/2.47.0 (owl-smile)';

/** Добавляет User-Agent, если его нет. В браузере fetch всё равно подставит свой. */
export function withUserAgent(http: HttpClient): HttpClient {
  return {
    request: (req) => {
      const headers = { ...req.headers };
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'user-agent')) headers['user-agent'] = GIT_USER_AGENT;
      return http.request({ ...req, headers });
    },
  };
}

export class DataRepo {
  private readonly url: string;

  private readonly http: HttpClient;

  constructor(
    private readonly fs: GitFs,
    http: HttpClient,
    private readonly dir: string,
    private readonly cfg: RepoConfig,
  ) {
    this.url = repoUrl(cfg);
    this.http = withUserAgent(http);
  }

  private get base() {
    return { fs: this.fs, dir: this.dir };
  }

  private onAuth = () => ({ username: this.cfg.user, password: this.cfg.token });

  /**
   * Авторизация сразу в заголовке. Без неё сервер сначала отвечает 401 с WWW-Authenticate,
   * и браузер показывает своё окно ввода пароля — запрос из расширения зависает.
   */
  private authHeaders(): Record<string, string> {
    const raw = new TextEncoder().encode(`${this.cfg.user}:${this.cfg.token}`);
    return { Authorization: `Basic ${btoa(String.fromCharCode(...raw))}` };
  }

  private async ensureInit(): Promise<void> {
    try {
      await git.resolveRef({ ...this.base, ref: 'HEAD', depth: 1 });
    } catch {
      await git.init({ ...this.base, defaultBranch: this.cfg.branch });
    }
    await git.addRemote({ ...this.base, remote: 'origin', url: this.url, force: true });
  }

  /** Скачивает последний коммит ветки (неглубоко). Возвращает его oid. */
  async fetchLatest(): Promise<string> {
    await this.ensureInit();
    const res = await git.fetch({
      ...this.base,
      http: this.http,
      remote: 'origin',
      ref: this.cfg.branch,
      singleBranch: true,
      depth: 1,
      tags: false,
      onAuth: this.cfg.token ? this.onAuth : undefined,
    });
    if (!res.fetchHead) throw new Error(`Ветка ${this.cfg.branch} пуста или не найдена`);
    return res.fetchHead;
  }

  async readBlob(oid: string): Promise<Uint8Array> {
    return (await git.readBlob({ ...this.base, oid })).blob;
  }

  private async listDir(commit: string, filepath: string): Promise<TreeEntry[]> {
    try {
      return (await git.readTree({ ...this.base, oid: commit, filepath })).tree;
    } catch (e) {
      if (e instanceof Errors.NotFoundError) return [];
      throw e;
    }
  }

  private async readJsonDir<T>(
    commit: string,
    dirPath: string,
    schema: ZodType<T>,
    problems: string[],
    check: (name: string, value: T) => boolean,
  ): Promise<Array<[string, T]>> {
    const out: Array<[string, T]> = [];
    for (const e of await this.listDir(commit, dirPath)) {
      if (e.type !== 'blob' || !e.path.endsWith('.json')) continue;
      const name = e.path.slice(0, -5);
      const file = `${dirPath}/${e.path}`;
      try {
        const parsed = schema.safeParse(JSON.parse(dec.decode(await this.readBlob(e.oid))));
        if (parsed.success && check(name, parsed.data)) out.push([name, parsed.data]);
        else problems.push(file);
      } catch {
        problems.push(file);
      }
    }
    return out;
  }

  /** Читает все данные на коммите `head`. Невалидные файлы пропускаются. */
  async readSnapshot(head: string): Promise<Snapshot> {
    const problems: string[] = [];
    const snap: Snapshot = { head, emotes: {}, badges: {}, paints: {}, users: {}, images: {}, problems };

    for (const e of await this.listDir(head, 'img')) {
      if (e.type === 'blob') snap.images[`img/${e.path}`] = e.oid;
    }
    const hasImage = (p: string) => p in snap.images;

    for (const [, v] of await this.readJsonDir(head, 'emotes', EmoteSchema, problems, (n, v) => n === v.code && hasImage(v.image)))
      snap.emotes[v.code] = v;
    for (const [, v] of await this.readJsonDir(head, 'badges', BadgeSchema, problems, (n, v) => n === v.id && hasImage(v.image)))
      snap.badges[v.id] = v;
    for (const [, v] of await this.readJsonDir(head, 'paints', PaintSchema, problems, (n, v) => n === v.id))
      snap.paints[v.id] = v;
    for (const platform of PLATFORMS) {
      for (const [nick, v] of await this.readJsonDir(head, `users/${platform}`, UserSchema, problems, (n) => n === normalizeNick(n) && isValidNick(platform, n)))
        snap.users[userKey(platform, nick)] = v;
    }
    return snap;
  }

  /** Строит новое дерево из `baseTree` с применёнными изменениями. null — дерево стало пустым. */
  private async buildTree(baseTree: string | null, changes: Changes): Promise<string | null> {
    const entries = new Map<string, TreeEntry>();
    if (baseTree) for (const e of (await git.readTree({ ...this.base, oid: baseTree })).tree) entries.set(e.path, e);

    const nested = new Map<string, Changes>();
    for (const [p, data] of changes) {
      const i = p.indexOf('/');
      if (i < 0) {
        if (data === null) entries.delete(p);
        else entries.set(p, { mode: '100644', path: p, type: 'blob', oid: await git.writeBlob({ ...this.base, blob: data }) });
      } else {
        const head = p.slice(0, i);
        let sub = nested.get(head);
        if (!sub) nested.set(head, (sub = new Map()));
        sub.set(p.slice(i + 1), data);
      }
    }
    for (const [name, sub] of nested) {
      const existing = entries.get(name);
      const oid = await this.buildTree(existing?.type === 'tree' ? existing.oid : null, sub);
      if (oid) entries.set(name, { mode: '040000', path: name, type: 'tree', oid });
      else entries.delete(name);
    }
    if (entries.size === 0) return null;
    return git.writeTree({ ...this.base, tree: [...entries.values()] });
  }

  /**
   * Применяет изменения и отправляет их в репозиторий.
   * `mutate` вызывается на свежем снимке; при гонке (push отклонён) всё повторяется
   * на новом снимке, поэтому проверки уникальности внутри `mutate` остаются корректными.
   * Возвращает oid нового коммита.
   */
  async commitAndPush(
    mutate: (snap: Snapshot) => Changes | Promise<Changes>,
    message: string,
    authorName: string,
  ): Promise<string> {
    if (!this.cfg.token) throw new Error('Не введён ключ доступа для загрузки');
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
      const head = await this.fetchLatest();
      const snap = await this.readSnapshot(head);
      const changes = await mutate(snap);
      if (changes.size === 0) return head;

      const { commit } = await git.readCommit({ ...this.base, oid: head });
      const tree = await this.buildTree(commit.tree, changes);
      if (!tree) throw new Error('Нельзя удалить все файлы репозитория');
      const now = Math.floor(Date.now() / 1000);
      const who = { name: authorName, email: 'owl-smile@users.noreply', timestamp: now, timezoneOffset: new Date().getTimezoneOffset() };
      const oid = await git.writeCommit({
        ...this.base,
        commit: { message, tree, parent: [head], author: who, committer: who },
      });
      await git.writeRef({ ...this.base, ref: 'refs/heads/owl-upload', value: oid, force: true });

      try {
        const res = await git.push({
          ...this.base,
          http: this.http,
          remote: 'origin',
          ref: 'owl-upload',
          remoteRef: `refs/heads/${this.cfg.branch}`,
          headers: this.authHeaders(),
          onAuth: this.onAuth,
        });
        if (res.ok) return oid;
        lastError = new Error(res.error ?? 'push отклонён');
        if (!isRetryable(res.error ?? '')) throw lastError;
      } catch (e) {
        lastError = e;
        if (!(e instanceof Errors.PushRejectedError) && !isRetryable(String((e as Error)?.message))) throw e;
      }
    }
    throw new ConflictError(`Не удалось сохранить после ${MAX_PUSH_ATTEMPTS} попыток: ${String((lastError as Error)?.message ?? lastError)}`);
  }

  /** Проверяет ключ: пускает ли сервер на push. false — ключ неверный или без права записи. */
  async checkWriteAccess(): Promise<boolean> {
    if (!this.cfg.token) return false;
    try {
      await git.listServerRefs({
        http: this.http,
        url: this.url,
        forPush: true,
        protocolVersion: 1,
        headers: this.authHeaders(),
      });
      return true;
    } catch (e) {
      if (e instanceof Errors.HttpError && [401, 403].includes((e.data as { statusCode: number }).statusCode)) return false;
      throw e;
    }
  }

  /** Проверяет, что в репозитории есть meta.json нужной версии. */
  async checkMeta(head: string): Promise<boolean> {
    try {
      const { blob } = await git.readBlob({ ...this.base, oid: head, filepath: 'meta.json' });
      return MetaSchema.safeParse(JSON.parse(dec.decode(blob))).success;
    } catch {
      return false;
    }
  }
}

function isRetryable(msg: string): boolean {
  return /fast-forward|fetch first|stale info|incorrect old value|failed to lock|cannot lock/i.test(msg);
}
