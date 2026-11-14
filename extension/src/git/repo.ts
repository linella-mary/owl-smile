import git, { Errors, type HttpClient, type TreeEntry } from 'isomorphic-git';
import type { ZodType } from 'zod';
import { repoUrl, type RepoConfig } from '../shared/config';
import {
  BadgeInfoSchema,
  BadgeSchema,
  SLUG_RE,
  EmoteSchema,
  MetaSchema,
  NameplateSchema,
  PaintSchema,
  ProfileSchema,
  PLATFORMS,
  UserSchema,
  isValidNick,
  normalizeNick,
  userKey,
  type Badge,
  type BadgeInfo,
  type Emote,
  type Nameplate,
  type Paint,
  type Profile,
  type UserCosmetics,
} from '../shared/schema';

/** Любой fs, который понимает isomorphic-git (LightningFS в браузере, node:fs в скриптах). */
export type GitFs = Parameters<typeof git.init>[0]['fs'];

/** Снимок данных репозитория на конкретном коммите. */
export interface Snapshot {
  head: string;
  emotes: Record<string, Emote>;
  badges: Record<string, Badge>;
  /** Описания иконок (badges-info/). */
  badgeInfo: Record<string, BadgeInfo>;
  paints: Record<string, Paint>;
  /** Ключ — "twitch:login" / "vk:nick". */
  users: Record<string, UserCosmetics>;
  nameplates: Record<string, Nameplate>;
  /** Ключ — "twitch:login" / "vk:nick". Незнакомые поля из будущих версий сохраняются как есть. */
  profiles: Record<string, Profile>;
  /** Путь картинки ("img/....webp") → oid git-блоба. */
  images: Record<string, string>;
  /** Файлы, не прошедшие проверку (пропущены). */
  problems: string[];
}

/** Изменение файла: содержимое или null (удалить). */
export type Changes = Map<string, Uint8Array | null>;

export class ConflictError extends Error {}

const MAX_PUSH_ATTEMPTS = 3;
/** Пересобрать локальную копию, если pack-файлов больше (чтение объектов перебирает их все). */
const MAX_PACKS = 40;
/** Запас роста локальной копии сверх удвоенного размера свежей (см. compactIfBloated). */
const COMPACT_SLACK_BYTES = 2 * 1024 * 1024;

/** То, что нужно от fs для учёта места и пересборки копии (есть у LightningFS и node:fs). */
interface PromiseFs {
  readdir(p: string): Promise<string[]>;
  stat(p: string): Promise<{ isDirectory(): boolean; size: number }>;
  unlink(p: string): Promise<void>;
  rmdir(p: string): Promise<void>;
  readFile(p: string, enc: 'utf8'): Promise<string>;
  writeFile(p: string, data: string, enc: 'utf8'): Promise<void>;
}
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

  /** Промисный интерфейс fs: у LightningFS и node:fs он в .promises. */
  private get pfs(): PromiseFs {
    const f = this.fs as unknown as { promises?: PromiseFs };
    return f.promises ?? (this.fs as unknown as PromiseFs);
  }

  /** Сколько места занимают объекты локальной копии и сколько в ней pack-файлов. */
  async storageUsage(): Promise<{ bytes: number; packs: number }> {
    let bytes = 0;
    let packs = 0;
    const walk = async (p: string): Promise<void> => {
      let names: string[];
      try {
        names = await this.pfs.readdir(p);
      } catch {
        return;
      }
      for (const name of names) {
        const full = `${p}/${name}`;
        const st = await this.pfs.stat(full);
        if (st.isDirectory()) await walk(full);
        else {
          bytes += st.size;
          if (name.endsWith('.pack')) packs++;
        }
      }
    };
    await walk(`${this.dir}/.git/objects`);
    return { bytes, packs };
  }

  private baselinePath = () => `${this.dir}/.git/owl-baseline`;

  private async rmrf(p: string): Promise<void> {
    let st;
    try {
      st = await this.pfs.stat(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const name of await this.pfs.readdir(p)) await this.rmrf(`${p}/${name}`);
      await this.pfs.rmdir(p);
    } else {
      await this.pfs.unlink(p);
    }
  }

  /**
   * Сборка мусора по-простому (в isomorphic-git её нет): в копии остаются картинки, удалённые
   * из репозитория, и копятся pack-файлы. Когда копия выросла больше чем вдвое (+2 МБ) против
   * размера после свежего скачивания или pack-файлов больше MAX_PACKS — стираем её и скачиваем
   * заново только последний коммит. Возвращает true, если копия пересобрана.
   * `force` — пересобрать в любом случае.
   */
  async compactIfBloated(force = false): Promise<boolean> {
    const { bytes, packs } = await this.storageUsage();
    const baseline = Number(await this.pfs.readFile(this.baselinePath(), 'utf8').catch(() => '0')) || 0;
    if (!baseline && !force) {
      // Копия от прошлой версии — считаем точкой отсчёта текущий размер
      if (bytes) await this.pfs.writeFile(this.baselinePath(), String(bytes), 'utf8');
      return false;
    }
    if (!force && bytes <= baseline * 2 + COMPACT_SLACK_BYTES && packs <= MAX_PACKS) return false;
    await this.rmrf(`${this.dir}/.git`);
    await this.fetchLatest();
    return true;
  }

  /**
   * Скачивает последний коммит ветки. Возвращает его oid.
   *
   * Первый раз — неглубоко (только последний коммит), дальше — обычная догрузка новых объектов.
   * Локальная ветка (refs/heads/<branch>) переставляется на скачанный коммит: при singleBranch
   * isomorphic-git сообщает серверу «уже есть» только по ней. Раньше её не было, fetch шёл с deepen,
   * и каждая синхронизация скачивала весь репозиторий заново новым pack-файлом
   * (замер scripts/measure-git-growth.ts: 23 МБ локально при 300 КБ данных).
   */
  async fetchLatest(): Promise<string> {
    await this.ensureInit();
    const have = await git.resolveRef({ ...this.base, ref: `refs/heads/${this.cfg.branch}` }).catch(() => null);
    const res = await git.fetch({
      ...this.base,
      http: this.http,
      remote: 'origin',
      ref: this.cfg.branch,
      singleBranch: true,
      // Первый раз — только последний коммит. Дальше — обычная догрузка: с deepen сервер
      // пересылает всё дерево, даже если «уже есть» ему сообщили
      ...(have ? {} : { depth: 1 }),
      tags: false,
      onAuth: this.cfg.token ? this.onAuth : undefined,
    });
    if (!res.fetchHead) throw new Error(`Ветка ${this.cfg.branch} пуста или не найдена`);
    await git.writeRef({ ...this.base, ref: `refs/heads/${this.cfg.branch}`, value: res.fetchHead, force: true });
    // Свежая копия — точка отсчёта для compactIfBloated
    if (!have) await this.pfs.writeFile(this.baselinePath(), String((await this.storageUsage()).bytes || 1), 'utf8');
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
    const snap: Snapshot = { head, emotes: {}, badges: {}, badgeInfo: {}, paints: {}, users: {}, nameplates: {}, profiles: {}, images: {}, problems };

    for (const e of await this.listDir(head, 'img')) {
      if (e.type === 'blob') snap.images[`img/${e.path}`] = e.oid;
    }
    const hasImage = (p: string) => p in snap.images;

    for (const [, v] of await this.readJsonDir(head, 'emotes', EmoteSchema, problems, (n, v) => n === v.code && hasImage(v.image)))
      snap.emotes[v.code] = v;
    for (const [, v] of await this.readJsonDir(head, 'badges', BadgeSchema, problems, (n, v) => n === v.id && hasImage(v.image)))
      snap.badges[v.id] = v;
    for (const [id, v] of await this.readJsonDir(head, 'badges-info', BadgeInfoSchema, problems, (n) => SLUG_RE.test(n)))
      snap.badgeInfo[id] = v;
    for (const [, v] of await this.readJsonDir(head, 'paints', PaintSchema, problems, (n, v) => n === v.id))
      snap.paints[v.id] = v;
    for (const platform of PLATFORMS) {
      for (const [nick, v] of await this.readJsonDir(head, `users/${platform}`, UserSchema, problems, (n) => n === normalizeNick(n) && isValidNick(platform, n)))
        snap.users[userKey(platform, nick)] = v;
      for (const [nick, v] of await this.readJsonDir(head, `profiles/${platform}`, ProfileSchema, problems, (n) => n === normalizeNick(n) && isValidNick(platform, n)))
        snap.profiles[userKey(platform, nick)] = v;
    }
    for (const [, v] of await this.readJsonDir(head, 'nameplates', NameplateSchema, problems, (n, v) => n === v.id && (!v.image || hasImage(v.image))))
      snap.nameplates[v.id] = v;
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
    await this.compactIfBloated();
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
        if (res.ok) {
          // Свой коммит уже есть локально — следующий fetch не будет скачивать его обратно
          await git.writeRef({ ...this.base, ref: `refs/heads/${this.cfg.branch}`, value: oid, force: true });
          return oid;
        }
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
