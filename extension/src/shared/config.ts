/**
 * Настройки репозитория данных. Подставляются при сборке из .env (префикс WXT_).
 * Секретов здесь нет: ключ записи в сборку НЕ попадает — пользователь вводит его
 * на странице загрузки (см. shared/key.ts).
 */
export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  /** Логин для git push (псевдоним владельца токена развёртывания). */
  user: string;
  /** Ключ записи (токен развёртывания); пусто — только чтение. */
  token: string;
  /** Адрес сервера; по умолчанию https://gitflic.ru (переопределяется в тестах). */
  host?: string;
}

export function repoUrl(c: Pick<RepoConfig, 'owner' | 'repo' | 'host'>): string {
  return `${c.host ?? 'https://gitflic.ru'}/project/${c.owner}/${c.repo}.git`;
}

export const config: RepoConfig = {
  owner: import.meta.env?.WXT_GITFLIC_OWNER ?? '',
  repo: import.meta.env?.WXT_GITFLIC_REPO ?? 'owl-smile-data',
  branch: import.meta.env?.WXT_GITFLIC_BRANCH ?? 'master',
  user: import.meta.env?.WXT_GITFLIC_USER || import.meta.env?.WXT_GITFLIC_OWNER || '',
  token: '',
  host: import.meta.env?.WXT_GITFLIC_HOST || undefined,
};

export const isConfigured = () => Boolean(config.owner && config.repo);

/**
 * Админ (один): ник и SHA-256 его личного ключа (hex). Сам ключ в сборку не попадает.
 * Не задан — админского режима нет, все с ключом записи могут всё (как до версии 0.6.1).
 * Ключ и отпечаток создаёт `npm run admin:key`.
 */
export const admin = {
  nick: (import.meta.env?.WXT_ADMIN_NICK ?? '').trim(),
  keySha256: (import.meta.env?.WXT_ADMIN_KEY_SHA256 ?? '').trim().toLowerCase(),
};

export const adminEnabled = () => Boolean(admin.nick && /^[0-9a-f]{64}$/.test(admin.keySha256));
