import { canResizeAnimation, resizeAnimation, TooManyFramesError } from './animated';
import type { PreparedImage } from './ops';
import { UserError } from './ops';

/**
 * Размеры как у Twitch / 7TV / BTTV:
 *   смайл  — показ высотой 28 px, хранение 4x = 112 px по высоте (ширина до 4:1);
 *   иконка — показ 18×18, хранение 4x = 72×72.
 * 4x даёт чёткую картинку на любых экранах (масштаб 100–400 %), а файлы остаются маленькими.
 */
export const IMAGE_LIMITS = {
  /** Исходный файл: можно тяжёлый — всё равно уменьшаем. */
  maxInputBytes: 5 * 1024 * 1024,
  emoteHeight: 112,
  /** Ниже этой высоты на чётких экранах смайл будет мыльным. */
  emoteRecommendedMin: 56,
  emoteMaxRatio: 4,
  badgeSize: 72,
  badgeRecommendedMin: 36,
  /** Подложка под ник: показ ~20–24 px по высоте, хранение до 64 px (≈3x), полоса до 8:1. */
  nameplateHeight: 64,
  nameplateMaxRatio: 8,
  /** Готовая анимация — столько хранит у себя каждый зритель. */
  maxAnimatedBytes: 512 * 1024,
  maxFrames: 300,
} as const;

export type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp';
export type ImagePurpose = 'emote' | 'badge' | 'nameplate';

/** Определяет формат по сигнатуре (а не по расширению имени файла). */
export function sniff(b: Uint8Array): ImageKind | null {
  const ascii = (from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len));
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'gif';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
  return null;
}

/** Анимированный ли GIF/WebP (без полного декодирования). */
export function isAnimated(b: Uint8Array, kind: ImageKind): boolean {
  if (kind === 'webp') {
    // VP8X-контейнер: байт флагов после заголовка чанка, бит 1 — анимация.
    const ascii = String.fromCharCode(...b.subarray(12, 16));
    return ascii === 'VP8X' && b.length > 20 && (b[20]! & 0x02) !== 0;
  }
  if (kind === 'gif') {
    // Больше одного блока Graphic Control Extension (21 F9 04) — почти всегда анимация.
    let count = 0;
    for (let i = 13; i < b.length - 2; i++) {
      if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04 && ++count > 1) return true;
    }
  }
  return false;
}

/** Размер смайла при хранении: высота до 112, пропорции сохраняются, без увеличения. */
export function emoteSize(srcW: number, srcH: number): { w: number; h: number } {
  const h = Math.min(IMAGE_LIMITS.emoteHeight, srcH);
  return { w: Math.max(1, Math.round((srcW * h) / srcH)), h };
}

/** Размер подложки: высота до 64, пропорции сохраняются, без увеличения. */
export function nameplateSize(srcW: number, srcH: number): { w: number; h: number } {
  const h = Math.min(IMAGE_LIMITS.nameplateHeight, srcH);
  return { w: Math.max(1, Math.round((srcW * h) / srcH)), h };
}

/** Размер иконки: вписать в 72×72, без увеличения. */
export function badgeSize(srcW: number, srcH: number): { w: number; h: number } {
  const k = Math.min(1, IMAGE_LIMITS.badgeSize / Math.max(srcW, srcH));
  return { w: Math.max(1, Math.round(srcW * k)), h: Math.max(1, Math.round(srcH * k)) };
}

/** Подсказки о качестве исходника (не мешают загрузке). */
export function qualityWarnings(purpose: ImagePurpose, srcW: number, srcH: number): string[] {
  const out: string[] = [];
  if (purpose === 'emote' && srcH < IMAGE_LIMITS.emoteRecommendedMin)
    out.push(`Картинка мелкая (${srcW}×${srcH}): на чётких экранах будет размытой. Лучше от 112 px по высоте.`);
  if (purpose === 'badge') {
    if (Math.max(srcW, srcH) < IMAGE_LIMITS.badgeRecommendedMin)
      out.push(`Иконка мелкая (${srcW}×${srcH}): лучше от 72×72.`);
    if (Math.abs(srcW - srcH) > Math.max(srcW, srcH) * 0.1) out.push('Иконка не квадратная — по бокам останутся пустые поля.');
  }
  if (purpose === 'nameplate' && srcW < srcH * 2)
    out.push('Подложка узкая: под длинным ником её обрежет сверху и снизу. Лучше широкая полоса, от 4:1.');
  return out;
}

export async function sha16(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return [...digest.subarray(0, 8)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export interface PrepareResult extends PreparedImage {
  /** Размер исходника. */
  srcW: number;
  srcH: number;
  frames: number;
  warnings: string[];
}

/**
 * Проверяет и готовит картинку к загрузке (в странице расширения — нужен OffscreenCanvas).
 *  - статичные → WebP нужного размера;
 *  - анимированные смайлы → уменьшаются до 112 px по высоте (GIF); если уже маленькие и лёгкие — как есть;
 *  - иконки всегда статичные (берётся первый кадр).
 */
export async function prepareImage(file: Blob, purpose: ImagePurpose): Promise<PrepareResult> {
  const L = IMAGE_LIMITS;
  if (file.size > L.maxInputBytes) throw new UserError('Файл больше 5 МБ');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (!kind) throw new UserError('Это не картинка: поддерживаются PNG, JPEG, GIF и WebP');
  const mime = `image/${kind}`;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
  } catch {
    throw new UserError('Не удалось прочитать картинку — файл повреждён');
  }
  const srcW = bitmap.width;
  const srcH = bitmap.height;

  try {
    if (purpose === 'emote' && srcW / srcH > L.emoteMaxRatio) throw new UserError('Слишком широкая картинка (максимум 4:1)');
    if (purpose === 'nameplate' && srcW / srcH > L.nameplateMaxRatio) throw new UserError('Слишком широкая картинка (максимум 8:1)');
    const warnings = qualityWarnings(purpose, srcW, srcH);
    const sizeOf = purpose === 'emote' ? emoteSize : purpose === 'nameplate' ? nameplateSize : badgeSize;

    // Анимация — у смайлов и подложек; иконки всегда статичные
    if (purpose !== 'badge' && isAnimated(bytes, kind)) {
      const target = sizeOf(srcW, srcH);
      const keepOriginal = srcH <= target.h && bytes.length <= L.maxAnimatedBytes;
      let out: { bytes: Uint8Array; w: number; h: number; frames: number; ext: 'gif' | 'webp' };
      if (keepOriginal) {
        out = { bytes, w: srcW, h: srcH, frames: 0, ext: kind === 'gif' ? 'gif' : 'webp' };
      } else if (canResizeAnimation()) {
        try {
          const r = await resizeAnimation(bytes, mime, target.h, L.maxFrames);
          out = { ...r, ext: 'gif' };
        } catch (e) {
          if (e instanceof TooManyFramesError) throw new UserError(`Слишком длинная анимация: ${e.frames} кадров (максимум ${L.maxFrames})`);
          throw e;
        }
      } else {
        throw new UserError(`Браузер не умеет уменьшать анимацию — загрузите GIF высотой до ${target.h} px`);
      }
      if (out.bytes.length > L.maxAnimatedBytes)
        throw new UserError(
          `Анимация после уменьшения весит ${Math.ceil(out.bytes.length / 1024)} КБ (максимум 512). Сократите число кадров или длительность.`,
        );
      return {
        bytes: out.bytes,
        path: `img/${await sha16(out.bytes)}.${out.ext}`,
        w: out.w,
        h: out.h,
        animated: true,
        srcW,
        srcH,
        frames: out.frames,
        warnings,
      };
    }

    const { w, h } = sizeOf(srcW, srcH);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const out = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/webp', quality: 0.92 })).arrayBuffer());
    if (sniff(out) !== 'webp') throw new UserError('Браузер не смог перекодировать картинку в WebP');
    return { bytes: out, path: `img/${await sha16(out)}.webp`, w, h, animated: false, srcW, srcH, frames: 1, warnings };
  } finally {
    bitmap.close();
  }
}
