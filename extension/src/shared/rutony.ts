/**
 * Выгрузка смайлов Owl Smile в «свои смайлы» RutonyChat.
 * RutonyChat берёт картинки из своего каталога: имя файла без расширения — код смайла.
 * Здесь только чистая логика (что записать, что удалить, zip); работа с папкой — в rutony/export.ts.
 */

/** Файл, который должен лежать в каталоге RutonyChat. */
export interface RutonyFile {
  /** Имя файла: `<Code>.<ext>`. */
  name: string;
  code: string;
  /** oid картинки в базе: по нему видно, что смайл поменялся. */
  oid: string;
}

/** Что мы выгрузили в прошлый раз: имя файла → oid. */
export type RutonyManifest = Record<string, string>;

export interface ExportPlan {
  /** Записать (новые и изменившиеся). */
  write: RutonyFile[];
  /** Удалить: наши прошлые файлы, которых больше нет или которые переименованы. */
  remove: string[];
  /** Не трогаем: в каталоге уже есть чужой файл с таким кодом. */
  skipped: RutonyFile[];
  /** Уже лежат и не поменялись. */
  unchanged: RutonyFile[];
}

const lower = (s: string) => s.toLowerCase();
/** Код смайла по имени файла — так его видит RutonyChat. Регистр не важен: на Windows это один файл. */
const baseOf = (name: string) => lower(name.replace(/\.[^.]*$/, ''));

/**
 * @param desired  что должно лежать в каталоге
 * @param prev     что выгружали в прошлый раз
 * @param existing имена файлов, которые сейчас лежат в каталоге
 */
export function planExport(desired: RutonyFile[], prev: RutonyManifest, existing: Iterable<string>): ExportPlan {
  const onDisk = new Set([...existing].map(lower));
  // Наши файлы — только те, что мы записали и они всё ещё на месте
  const ours = new Map<string, { name: string; oid: string }>();
  for (const [name, oid] of Object.entries(prev)) {
    if (onDisk.has(lower(name))) ours.set(lower(name), { name, oid });
  }
  // Коды чужих файлов: файлы самого стримера (и всё, что мы не записывали)
  const foreign = new Set([...onDisk].filter((n) => !ours.has(n)).map(baseOf));

  const plan: ExportPlan = { write: [], remove: [], skipped: [], unchanged: [] };
  const wanted = new Set<string>();
  for (const f of desired) {
    const own = ours.get(lower(f.name));
    if (!own && foreign.has(baseOf(f.name))) {
      plan.skipped.push(f);
      continue;
    }
    wanted.add(lower(f.name));
    if (!own) plan.write.push(f);
    else if (own.name !== f.name) {
      // Код переименован только регистром: удалить и записать заново, иначе Windows оставит старое имя
      plan.remove.push(own.name);
      plan.write.push(f);
    } else if (own.oid !== f.oid) plan.write.push(f);
    else plan.unchanged.push(f);
  }
  for (const [key, own] of ours) {
    if (!wanted.has(key)) plan.remove.push(own.name);
  }
  return plan;
}

/** Манифест после выгрузки: записанные и не изменившиеся файлы. */
export function nextManifest(plan: ExportPlan, written: RutonyFile[]): RutonyManifest {
  const out: RutonyManifest = {};
  for (const f of [...plan.unchanged, ...written]) out[f.name] = f.oid;
  return out;
}

// ——— zip ———

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Zip без сжатия (метод «stored»): картинки и так сжаты.
 * Имена в UTF-8 (флаг 0x0800), дата — 1 января 2020, чтобы архив не зависел от времени.
 */
export function buildZip(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const DOS_TIME = 0;
  const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.bytes);
    const size = f.bytes.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // версия для распаковки
    lv.setUint16(6, 0x0800, true); // имена в UTF-8
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // кем создан
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    // 30..41: extra, comment, disk, атрибуты — нули
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, f.bytes);
    centrals.push(central);
    offset += local.length + size;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let pos = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}
