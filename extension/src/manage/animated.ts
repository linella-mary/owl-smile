import { applyPalette, GIFEncoder, quantize } from 'gifenc';

/** Минимальные типы WebCodecs ImageDecoder (есть в Chromium 94+). */
type DecodedImage = CanvasImageSource & { displayWidth: number; displayHeight: number; duration: number | null; close(): void };
interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  completed: Promise<void>;
  decode(opts: { frameIndex: number }): Promise<{ image: DecodedImage }>;
  close(): void;
}
type ImageDecoderCtor = new (init: { data: Uint8Array; type: string }) => ImageDecoderLike;

export const canResizeAnimation = (): boolean => 'ImageDecoder' in globalThis && 'OffscreenCanvas' in globalThis;

export class TooManyFramesError extends Error {
  constructor(readonly frames: number) {
    super(`frames: ${frames}`);
  }
}

/**
 * Уменьшает анимацию (GIF/WebP) до высоты `targetHeight` и кодирует в GIF.
 * Кадры берутся уже собранными (ImageDecoder учитывает disposal/blending исходника),
 * поэтому каждый кадр пишется целиком с очисткой (dispose = 2).
 */
export async function resizeAnimation(
  bytes: Uint8Array,
  mime: string,
  targetHeight: number,
  maxFrames: number,
): Promise<{ bytes: Uint8Array; w: number; h: number; frames: number }> {
  const Ctor = (globalThis as unknown as { ImageDecoder: ImageDecoderCtor }).ImageDecoder;
  const decoder = new Ctor({ data: bytes, type: mime });
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const frames = decoder.tracks.selectedTrack?.frameCount ?? 1;
    if (frames > maxFrames) throw new TooManyFramesError(frames);

    const gif = GIFEncoder();
    let w = 0;
    let h = 0;
    let ctx: OffscreenCanvasRenderingContext2D | null = null;
    for (let i = 0; i < frames; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      if (!ctx) {
        h = Math.max(1, Math.min(targetHeight, image.displayHeight));
        w = Math.max(1, Math.round((image.displayWidth * h) / image.displayHeight));
        ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
        ctx.imageSmoothingQuality = 'high';
      }
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(image, 0, 0, w, h);
      // Задержки меньше 20 мс браузеры показывают как 100 мс — не даём так получиться.
      const delay = Math.max(20, Math.round((image.duration ?? 100_000) / 1000));
      image.close();

      const { data } = ctx.getImageData(0, 0, w, h);
      let hasAlpha = false;
      for (let p = 3; p < data.length; p += 4) {
        if (data[p]! < 128) {
          hasAlpha = true;
          break;
        }
      }
      const format = hasAlpha ? 'rgba4444' : 'rgb565';
      const palette = quantize(data, 256, { format, oneBitAlpha: hasAlpha });
      const index = applyPalette(data, palette, format);
      const transparentIndex = hasAlpha ? palette.findIndex((c) => c[3] === 0) : -1;
      gif.writeFrame(index, w, h, {
        palette,
        delay,
        transparent: transparentIndex >= 0,
        transparentIndex: Math.max(0, transparentIndex),
        dispose: 2,
      });
    }
    gif.finish();
    return { bytes: gif.bytes(), w, h, frames };
  } finally {
    decoder.close();
  }
}
