import './polyfills';
import LightningFS from '@isomorphic-git/lightning-fs';
import { config } from '../shared/config';
import { getKey } from '../shared/key';
import { webHttp } from './http-web';
import { DataRepo } from './repo';

/**
 * Репозитории данных поверх IndexedDB расширения (LightningFS).
 * У фоновой синхронизации и страницы загрузки — разные базы,
 * чтобы два контекста не писали в одно git-хранилище одновременно.
 */
let syncRepo: DataRepo | null = null;
let writeFs: LightningFS | null = null;

/** Только чтение (без ключа) — для фоновой синхронизации. */
export function getRepo(): DataRepo {
  syncRepo ??= new DataRepo(new LightningFS('owl-smile-git-sync'), webHttp, '/data', config);
  return syncRepo;
}

/** Репозиторий с ключом записи. `key` — проверить конкретный ключ (иначе берётся сохранённый). */
export async function getWriteRepo(key?: string): Promise<DataRepo> {
  const token = key ?? (await getKey());
  writeFs ??= new LightningFS('owl-smile-git-write');
  return new DataRepo(writeFs, webHttp, '/data', { ...config, token });
}
