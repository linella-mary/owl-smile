import { useEffect, useRef, useState } from 'preact/hooks';
import { applyNameplate, applyPaint, plateView, type PlateSource, type PlateView } from '../../core/paint';
import type { LocalNameplate } from '../../shared/cache';
import {
  PLATE_ANIMS,
  PLATE_PATTERNS,
  PLATE_SHAPES,
  PLATE_SYMBOLS_MAX,
  PLATE_SYMBOL_PALETTE,
  SLUG_RE,
  isValidPlateSymbols,
  type PlateAnim,
  type PlatePattern,
  type PlateShape,
} from '../../shared/ids';
import type { Paint } from '../../shared/schema';
import { deleteNameplate, saveNameplate, UserError, type NameplateInput } from '../ops';
import { useRunner, type CacheView } from './common';

/** Подложка из кэша → вид для показа. */
export function cachedPlate(cache: CacheView, id: string | undefined): PlateView | null {
  const p: LocalNameplate | undefined = id ? cache.index?.nameplates?.[id] : undefined;
  return p ? plateView(p, p.img ? cache.images[p.img] : undefined) : null;
}

/** Ник с эффектом и подложкой — так же, как в чате. */
export function DecoratedName({ name, paint, plate }: { name: string; paint?: Paint | null; plate?: PlateView | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    applyPaint(ref.current, paint);
    applyNameplate(ref.current, plate ?? null);
  }, [paint && JSON.stringify(paint), plate && JSON.stringify(plate)]);
  // Обёртка — «родитель ника»: на нём слой для подложки (как в чате)
  return <span><span ref={ref} class="painted">{name}</span></span>;
}

const PATTERN_TITLES: Record<PlatePattern, string> = {
  slash: '//// Косые', backslash: '\\\\\\\\ Обратные', dots: ':::: Точки', grid: 'Сетка', lines: 'Линии', zigzag: 'Зигзаг',
  lightning: 'Молнии', waves: 'Волны', chevrons: '>>>> Шевроны', stars: 'Звёзды', hearts: 'Сердца', sparkles: 'Искры',
  diamonds: 'Ромбы', cross: 'Кресты',
};
const SHAPE_TITLES: Record<PlateShape, string> = { fill: 'За ником', pill: 'Плашка', underline: 'Подчёркивание', frame: 'Рамка' };
const ANIM_TITLES: Record<PlateAnim, string> = { none: 'Нет', slide: 'Плывёт', pulse: 'Дышит', shimmer: 'Блик', flicker: 'Мерцает' };
const SYMBOL_PRESETS = ['////', '::::', '\\\\\\\\', '||||', '+ + ', '~≈~≈', '-=-=', '***', '⚡', '✦✧', '★☆', '◆◇', '♥♡', '░▒▓', '╱╲'];

interface Draft {
  id: string;
  title: string;
  kind: 'pattern' | 'symbols';
  pattern: PlatePattern;
  symbols: string;
  c1: string;
  tint: boolean;
  c2: string;
  glow: number;
  opacity: number;
  shape: PlateShape;
  anim: PlateAnim;
  speed: number;
  fade: boolean;
  /** Второй слой: чередование 1-2-1-2 или шахматка. */
  alt: boolean;
  altColor: string;
  altPattern: PlatePattern | '';
  checker: boolean;
}

const blank = (): Draft => ({
  id: '', title: '', kind: 'pattern', pattern: 'slash', symbols: '////', c1: '#9147ff', tint: false, c2: '#1f1f23', glow: 0.5, opacity: 0.75,
  shape: 'fill', anim: 'none', speed: 4, fade: false, alt: false, altColor: '#00e5ff', altPattern: '', checker: false,
});

function toSource(d: Draft): PlateSource {
  return {
    title: d.title || 'подложка',
    kind: d.kind,
    ...(d.kind === 'pattern' ? { pattern: d.pattern } : { symbols: d.symbols }),
    colors: d.tint ? [d.c1, d.c2] : [d.c1],
    glow: d.glow,
    opacity: d.opacity,
    shape: d.shape,
    anim: d.anim,
    speed: d.speed,
    fade: d.fade,
    alt: d.alt ? { color: d.altColor, ...(d.altPattern ? { pattern: d.altPattern } : {}), checker: d.checker } : undefined,
  };
}

function toInput(d: Draft): NameplateInput {
  const s = toSource(d);
  return { ...s, id: d.id, title: d.title, kind: d.kind, opacity: d.opacity } as NameplateInput;
}

function fromCache(id: string, p: LocalNameplate): Draft {
  const b = blank();
  return {
    ...b,
    id,
    title: p.title,
    kind: p.kind === 'symbols' ? 'symbols' : 'pattern',
    pattern: p.pattern ?? b.pattern,
    symbols: p.symbols ?? b.symbols,
    c1: p.colors?.[0] ?? b.c1,
    tint: Boolean(p.colors?.[1]),
    c2: p.colors?.[1] ?? b.c2,
    glow: p.glow ?? 0,
    opacity: p.opacity ?? b.opacity,
    shape: p.shape ?? 'fill',
    anim: p.anim ?? 'none',
    speed: p.speed ?? 4,
    fade: Boolean(p.fade),
    alt: Boolean(p.alt),
    altColor: p.alt?.color ?? b.altColor,
    altPattern: p.alt?.pattern ?? '',
    checker: Boolean(p.alt?.checker),
  };
}

export function NameplatesTab({ cache, author }: { cache: CacheView; author: string }) {
  const runner = useRunner();
  const [d, setD] = useState<Draft>(blank());
  /** ID подложки, которую сейчас меняем (null — создаём новую). */
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });

  const live = plateView(toSource(d), undefined);
  const symbolsOk = d.kind !== 'symbols' || isValidPlateSymbols(d.symbols);
  const ok = SLUG_RE.test(d.id) && d.title.trim() && symbolsOk;
  const samplePaint = Object.values(cache.index?.paints ?? {})[0] ?? null;

  const submit = async () => {
    setError('');
    let mutation;
    try {
      mutation = saveNameplate(toInput(d), author, Boolean(editing));
    } catch (e) {
      setError(e instanceof UserError ? e.message : String(e));
      return;
    }
    if (await runner.run(`${editing ? 'Изменена' : 'Добавлена'} подложка ${d.id}`, mutation)) {
      setD(blank());
      setEditing(null);
    }
  };

  const plates = Object.entries(cache.index?.nameplates ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const used = (pid: string) => Object.values(cache.index?.profiles ?? {}).filter((p) => p.nameplate === pid).length;
  const kindTitle = (p: LocalNameplate) => (p.kind === 'pattern' ? 'узор' : p.kind === 'symbols' ? 'символы' : `старый вид: ${p.kind === 'emoji' ? 'эмодзи' : 'картинка'}`);

  return (
    <div class="stack">
      <section class="card stack plate-editor">
        <div class="presets">
          <button class={`ghost xs ${d.kind === 'pattern' ? 'active' : ''}`} onClick={() => set({ kind: 'pattern' })}>Узоры</button>
          <button class={`ghost xs ${d.kind === 'symbols' ? 'active' : ''}`} onClick={() => set({ kind: 'symbols' })}>Свои символы</button>
        </div>

        {d.kind === 'pattern' ? (
          <div class="pattern-gallery">
            {PLATE_PATTERNS.map((pt) => (
              <button key={pt} class={`ghost pattern-tile ${d.pattern === pt ? 'active' : ''}`} title={PATTERN_TITLES[pt]} onClick={() => set({ pattern: pt })}>
                <span class="chat-sample"><DecoratedName name="OwlViewer" plate={plateView({ ...toSource(d), pattern: pt, anim: 'none' }, undefined)} /></span>
                <span class="small muted">{PATTERN_TITLES[pt]}</span>
              </button>
            ))}
          </div>
        ) : (
          <div class="field">
            <span>Символы (до {PLATE_SYMBOLS_MAX}, повторяются по ширине ника)</span>
            <input class="symbols-input" value={d.symbols} maxLength={PLATE_SYMBOLS_MAX * 2} onInput={(e) => set({ symbols: e.currentTarget.value })} />
            {!symbolsOk && <span class="err small">Латиница, цифры, знаки и символы из палитры, до {PLATE_SYMBOLS_MAX}; без &lt; &gt; &amp; и кавычек</span>}
            <div class="row wrap">
              {SYMBOL_PRESETS.map((p) => <button key={p} class="ghost xs mono" onClick={() => set({ symbols: p })}>{p}</button>)}
            </div>
            <div class="row wrap palette">
              {[...PLATE_SYMBOL_PALETTE].map((ch) => (
                <button key={ch} class="ghost xs mono" onClick={() => set({ symbols: [...(d.symbols + ch)].slice(-PLATE_SYMBOLS_MAX).join('') })}>{ch}</button>
              ))}
            </div>
          </div>
        )}

        <div class="row wrap plate-controls">
          <label class="field">
            <span>Цвет</span>
            <input type="color" value={d.c1} onInput={(e) => set({ c1: e.currentTarget.value })} />
          </label>
          <label class="field">
            <span><input type="checkbox" checked={d.tint} onChange={(e) => set({ tint: e.currentTarget.checked })} /> Подкраска фона</span>
            <input type="color" value={d.c2} disabled={!d.tint} onInput={(e) => set({ c2: e.currentTarget.value })} />
          </label>
          <label class="field grow">
            <span>Свечение: {Math.round(d.glow * 100)}%</span>
            <input type="range" min={0} max={1} step={0.05} value={d.glow} onInput={(e) => set({ glow: Number(e.currentTarget.value) })} />
          </label>
          <label class="field grow">
            <span>Непрозрачность: {Math.round(d.opacity * 100)}%</span>
            <input type="range" min={0.15} max={1} step={0.05} value={d.opacity} onInput={(e) => set({ opacity: Number(e.currentTarget.value) })} />
          </label>
        </div>

        <div class="field alt-layer">
          <span><input type="checkbox" checked={d.alt} onChange={(e) => set({ alt: e.currentTarget.checked })} /> Второй слой — чередование «1-2-1-2»</span>
          {d.alt && (
            <div class="row wrap">
              <input type="color" value={d.altColor} title="Цвет второго слоя" onInput={(e) => set({ altColor: e.currentTarget.value })} />
              {d.kind === 'pattern' && (
                <select value={d.altPattern} onChange={(e) => set({ altPattern: e.currentTarget.value as PlatePattern | '' })}>
                  <option value="">тот же узор</option>
                  {PLATE_PATTERNS.map((pt) => <option key={pt} value={pt}>{PATTERN_TITLES[pt]}</option>)}
                </select>
              )}
              <div class="presets">
                <button class={`ghost xs ${!d.checker ? 'active' : ''}`} onClick={() => set({ checker: false })}>1-2-1-2 в ряд</button>
                <button class={`ghost xs ${d.checker ? 'active' : ''}`} onClick={() => set({ checker: true })}>Шахматка</button>
              </div>
            </div>
          )}
        </div>

        <div class="row wrap">
          <div class="field">
            <span>Форма</span>
            <div class="presets">
              {PLATE_SHAPES.map((sh) => <button key={sh} class={`ghost xs ${d.shape === sh ? 'active' : ''}`} onClick={() => set({ shape: sh })}>{SHAPE_TITLES[sh]}</button>)}
            </div>
          </div>
          <div class="field">
            <span>Анимация</span>
            <div class="presets">
              {PLATE_ANIMS.map((a) => <button key={a} class={`ghost xs ${d.anim === a ? 'active' : ''}`} onClick={() => set({ anim: a })}>{ANIM_TITLES[a]}</button>)}
            </div>
          </div>
          {d.anim !== 'none' && (
            <label class="field grow">
              <span>Скорость: {d.speed} с</span>
              <input type="range" min={0.5} max={12} step={0.5} value={d.speed} onInput={(e) => set({ speed: Number(e.currentTarget.value) })} />
            </label>
          )}
          <label class="field">
            <span>&nbsp;</span>
            <span><input type="checkbox" checked={d.fade} onChange={(e) => set({ fade: e.currentTarget.checked })} /> Растворять края</span>
          </label>
        </div>

        <div class="row">
          <label class="field grow">
            <span>ID (латиница, цифры, -)</span>
            <input value={d.id} disabled={Boolean(editing)} placeholder="neon-bolts" onInput={(e) => set({ id: e.currentTarget.value.trim().toLowerCase() })} />
          </label>
          <label class="field grow">
            <span>Название</span>
            <input value={d.title} maxLength={60} placeholder="Неоновые молнии" onInput={(e) => set({ title: e.currentTarget.value })} />
          </label>
        </div>
        {d.id && !SLUG_RE.test(d.id) && <div class="err small">2–32 символа: a–z, 0–9, -</div>}

        <div class="plate-preview">
          <span class="chat-sample big"><DecoratedName name="OwlViewer" plate={live} />: привет!</span>
          <span class="chat-sample big"><DecoratedName name="ОченьДлинныйНик_2026" plate={live} />: о</span>
          {samplePaint && <span class="chat-sample big"><DecoratedName name="С эффектом" paint={samplePaint} plate={live} />: ✨</span>}
        </div>
        <div class="plate-preview">
          <span class="muted small">Светлая тема:</span>
          <span class="chat-sample big light"><DecoratedName name="OwlViewer" plate={live} />: привет!</span>
          {samplePaint && <span class="chat-sample big light"><DecoratedName name="С эффектом" paint={samplePaint} plate={live} />: ✨</span>}
        </div>
        {error && <div class="err small">{error}</div>}
        <div class="row">
          <button disabled={!ok || runner.busy} onClick={() => void submit()}>{editing ? 'Сохранить изменения' : 'Создать подложку'}</button>
          {editing && <button class="ghost" onClick={() => { setEditing(null); setD(blank()); }}>Отмена</button>}
        </div>
      </section>

      <h2>Подложки · {plates.length}</h2>
      <div class="list">
        {plates.map(([pid, p]) => (
          <div class="list-row" key={pid}>
            <span class="chat-sample big"><DecoratedName name={p.title} plate={cachedPlate(cache, pid)} /></span>
            <span class="muted small grow">{pid} · {kindTitle(p)} · у {used(pid)} зрителей</span>
            {(p.kind === 'pattern' || p.kind === 'symbols') && (
              <button class="ghost xs" onClick={() => { setEditing(pid); setD(fromCache(pid, p)); scrollTo({ top: 0, behavior: 'smooth' }); }}>Изменить</button>
            )}
            <button class="ghost xs danger" disabled={runner.busy}
              onClick={() => confirm(`Удалить подложку «${p.title}» у всех?`) && void runner.run(`Удалена подложка ${pid}`, deleteNameplate(pid))}>
              Удалить
            </button>
          </div>
        ))}
        {!plates.length && <div class="muted">Пока пусто</div>}
      </div>
    </div>
  );
}
