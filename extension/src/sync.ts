import { getRepo } from './git/browser-repo';
import { NAMEPLATE_STYLE_FIELDS, PROFILE_FIELDS, commitIndex, getIndex, getStoredImageOids, setStatus, type LocalIndex, type LocalProfile } from './shared/cache';
import { isConfigured } from './shared/config';
import { mimeByPath, toDataUrl } from './shared/bytes';

export interface SyncResult {
  ok: boolean;
  changed: boolean;
  head?: string;
  error?: string;
}

let running: Promise<SyncResult> | null = null;

/** Синхронизация с репозиторием. Параллельные вызовы ждут одну и ту же синхронизацию. */
export function sync(force = false): Promise<SyncResult> {
  running ??= doSync(force).finally(() => (running = null));
  return running;
}

async function doSync(force: boolean): Promise<SyncResult> {
  if (!isConfigured()) {
    const error = 'Расширение собрано без адреса репозитория (WXT_GITFLIC_OWNER)';
    await setStatus({ state: 'error', at: Date.now(), error });
    return { ok: false, changed: false, error };
  }
  await setStatus({ state: 'syncing', at: Date.now() });
  try {
    const repo = getRepo();
    const head = await repo.fetchLatest();
    const prev = await getIndex();
    if (!force && prev?.head === head) {
      await setStatus({ state: 'idle', at: Date.now(), head });
      return { ok: true, changed: false, head };
    }

    const snap = await repo.readSnapshot(head);
    if (snap.problems.length) console.warn('[owl] пропущены невалидные файлы:', snap.problems);

    const index: LocalIndex = { head, syncedAt: Date.now(), emotes: {}, badges: {}, paints: snap.paints, users: snap.users, nameplates: {}, profiles: {} };
    const need = new Map<string, string>(); // oid → path
    for (const e of Object.values(snap.emotes)) {
      const oid = snap.images[e.image]!;
      need.set(oid, e.image);
      index.emotes[e.code] = { img: oid, animated: e.animated, w: e.w, h: e.h, author: e.author, createdAt: e.createdAt };
    }
    for (const b of Object.values(snap.badges)) {
      const oid = snap.images[b.image]!;
      need.set(oid, b.image);
      index.badges[b.id] = { img: oid, title: b.title };
      const description = snap.badgeInfo[b.id]?.description;
      if (description) index.badges[b.id]!.description = description;
    }
    for (const n of Object.values(snap.nameplates)) {
      const plate: NonNullable<LocalIndex['nameplates']>[string] = { title: n.title, kind: n.kind };
      if (n.image) {
        plate.img = snap.images[n.image]!;
        need.set(plate.img, n.image);
      }
      for (const f of NAMEPLATE_STYLE_FIELDS) if (n[f] !== undefined) (plate as unknown as Record<string, unknown>)[f] = n[f];
      index.nameplates![n.id] = plate;
    }
    for (const [key, p] of Object.entries(snap.profiles)) {
      // Только известные поля: незнакомое из будущих версий в чат не попадает
      const known: LocalProfile = {};
      for (const f of PROFILE_FIELDS) if (p[f] !== undefined) (known as Record<string, unknown>)[f] = p[f];
      if (Object.keys(known).length) index.profiles![key] = known;
    }

    const stored = new Set(await getStoredImageOids());
    const fresh: Record<string, string> = {};
    for (const [oid, path] of need) {
      if (!stored.has(oid)) fresh[oid] = toDataUrl(await repo.readBlob(oid), mimeByPath(path));
    }
    await commitIndex(index, fresh, new Set(need.keys()));
    // Удалённые из репозитория картинки и старые pack-файлы не должны копиться в IndexedDB
    await repo.compactIfBloated().catch((e) => console.warn('[owl] не удалось пересобрать локальную копию', e));
    await setStatus({ state: 'idle', at: Date.now(), head });
    return { ok: true, changed: true, head };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[owl] ошибка синхронизации', e);
    await setStatus({ state: 'error', at: Date.now(), error });
    return { ok: false, changed: false, error };
  }
}
