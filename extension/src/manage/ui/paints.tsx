import { useEffect, useRef, useState } from 'preact/hooks';
import { applyPaint } from '../../core/paint';
import { PAINT_PRESETS, SLUG_RE, type PaintPreset } from '../../shared/ids';
import type { Paint } from '../../shared/schema';
import { deletePaint, savePaint } from '../ops';
import { useRunner, type CacheView } from './common';

export const PRESET_TITLES: Record<PaintPreset, string> = {
  solid: 'Цвет',
  gradient: 'Градиент',
  shimmer: 'Переливание',
  glow: 'Свечение',
  flicker: 'Мерцание',
  rainbow: 'Радуга',
};

/** Ник с применённым эффектом. */
export function PaintedName({ paint, name = 'OwlViewer' }: { paint: Paint | null | undefined; name?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) applyPaint(ref.current, paint);
  }, [paint && JSON.stringify(paint)]);
  return <span ref={ref} class="painted">{name}</span>;
}

const blank = (): Paint => ({ id: '', title: '', preset: 'gradient', colors: ['#ffcc00', '#ff5e00'], angle: 90, speed: 3 });

export function PaintsTab({ cache }: { cache: CacheView }) {
  const runner = useRunner();
  const [p, setP] = useState<Paint>(blank());
  const set = (patch: Partial<Paint>) => setP({ ...p, ...patch });
  const paints = Object.values(cache.index?.paints ?? {}).sort((a, b) => a.id.localeCompare(b.id));
  const exists = Boolean(cache.index?.paints[p.id]);
  const ok = SLUG_RE.test(p.id) && p.title.trim();
  const animated = p.preset === 'shimmer' || p.preset === 'flicker' || p.preset === 'rainbow';

  return (
    <div class="stack">
      <section class="card paint-editor">
        <div class="stack grow">
          <div class="row">
            <label class="field grow">
              <span>ID</span>
              <input value={p.id} placeholder="gold-shimmer" onInput={(e) => set({ id: e.currentTarget.value.trim().toLowerCase() })} />
            </label>
            <label class="field grow">
              <span>Название</span>
              <input value={p.title} maxLength={60} placeholder="Золотое переливание" onInput={(e) => set({ title: e.currentTarget.value })} />
            </label>
          </div>
          <div class="presets">
            {PAINT_PRESETS.map((preset) => (
              <button key={preset} class={`ghost xs ${p.preset === preset ? 'active' : ''}`} onClick={() => set({ preset })}>
                {PRESET_TITLES[preset]}
              </button>
            ))}
          </div>
          {p.preset !== 'rainbow' && (
            <div class="row colors">
              {p.colors.map((c, i) => (
                <span class="color" key={i}>
                  <input type="color" value={c} onInput={(e) => set({ colors: p.colors.map((x, j) => (j === i ? e.currentTarget.value : x)) })} />
                  {p.colors.length > 1 && (
                    <button class="ghost xs" title="Убрать цвет" onClick={() => set({ colors: p.colors.filter((_, j) => j !== i) })}>×</button>
                  )}
                </span>
              ))}
              {p.colors.length < 5 && (
                <button class="ghost xs" onClick={() => set({ colors: [...p.colors, '#ffffff'] })}>+ цвет</button>
              )}
            </div>
          )}
          <div class="row">
            {(p.preset === 'gradient') && (
              <label class="field grow">
                <span>Угол: {p.angle ?? 90}°</span>
                <input type="range" min={0} max={360} value={p.angle ?? 90} onInput={(e) => set({ angle: Number(e.currentTarget.value) })} />
              </label>
            )}
            {animated && (
              <label class="field grow">
                <span>Скорость: {p.speed ?? 3} с</span>
                <input type="range" min={0.5} max={10} step={0.5} value={p.speed ?? 3} onInput={(e) => set({ speed: Number(e.currentTarget.value) })} />
              </label>
            )}
          </div>
        </div>
        <div class="paint-preview">
          <div class="chat-sample big">
            <PaintedName paint={p} />: привет всем
          </div>
          <button disabled={!ok || runner.busy}
            onClick={() => void runner.run(`${exists ? 'Изменён' : 'Добавлен'} эффект ${p.id}`, savePaint({ ...p, title: p.title.trim() })).then((done) => done && setP(blank()))}>
            {exists ? 'Сохранить изменения' : 'Создать эффект'}
          </button>
        </div>
      </section>

      <h2>Эффекты · {paints.length}</h2>
      <div class="list">
        {paints.map((x) => (
          <div class="list-row" key={x.id}>
            <span class="chat-sample"><PaintedName paint={x} name={x.title} /></span>
            <span class="muted small grow">{x.id} · {PRESET_TITLES[x.preset]}</span>
            <button class="ghost xs" onClick={() => setP({ ...x })}>Изменить</button>
            <button class="ghost xs danger" disabled={runner.busy}
              onClick={() => confirm(`Удалить эффект «${x.title}»?`) && void runner.run(`Удалён эффект ${x.id}`, deletePaint(x.id))}>
              Удалить
            </button>
          </div>
        ))}
        {!paints.length && <div class="muted">Пока пусто</div>}
      </div>
    </div>
  );
}
