import { useState } from 'preact/hooks';
import { SLUG_RE } from '../../shared/ids';
import { prepareImage, type PrepareResult } from '../image';
import { addBadge, deleteBadge, UserError } from '../ops';
import { DropZone, useRunner, type CacheView } from './common';

export function BadgesTab({ cache, author }: { cache: CacheView; author: string }) {
  const runner = useRunner();
  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [prepared, setPrepared] = useState<PrepareResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');

  const onFile = async (f: File) => {
    setError('');
    setPrepared(null);
    setPreview(null);
    try {
      const p = await prepareImage(f, 'badge');
      setPrepared(p);
      setPreview(URL.createObjectURL(new Blob([p.bytes as Uint8Array<ArrayBuffer>], { type: 'image/webp' })));
    } catch (e) {
      setError(e instanceof UserError ? e.message : String(e));
    }
  };

  const ok = prepared && SLUG_RE.test(id) && title.trim();
  const submit = async () => {
    if (!ok) return;
    if (await runner.run(`Добавлена иконка ${id}`, addBadge(id, title, prepared, author))) {
      setId('');
      setTitle('');
      setPrepared(null);
      setPreview(null);
    }
  };

  const badges = Object.entries(cache.index?.badges ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div class="stack">
      <section class="card upload">
        <DropZone
          onFile={(f) => void onFile(f)}
          preview={preview}
          hint={<>Иконка перед ником<br /><br />квадрат от 72×72<br />в чате будет 18×18 —<br />мелкие детали не видны</>}
        />
        <div class="stack grow">
          <label class="field">
            <span>ID (латиница, цифры, -)</span>
            <input value={id} placeholder="owl-founder" onInput={(e) => setId(e.currentTarget.value.trim().toLowerCase())} />
          </label>
          {id && !SLUG_RE.test(id) && <div class="err small">2–32 символа: a–z, 0–9, -</div>}
          <label class="field">
            <span>Название (подсказка при наведении)</span>
            <input value={title} maxLength={60} placeholder="Основатель совятника" onInput={(e) => setTitle(e.currentTarget.value)} />
          </label>
          {prepared && (
            <div class="row preview-row">
              <span class="muted small">В чате:</span>
              <span class="chat-sample">
                <img class="owl-badge" src={preview!} alt="" /> <b>ник</b>: привет
              </span>
              <span class="muted small" title="исходник → сохранится">
                {prepared.srcW}×{prepared.srcH} → {prepared.w}×{prepared.h} · {Math.ceil(prepared.bytes.length / 1024)} КБ
              </span>
            </div>
          )}
          {prepared?.warnings.map((w) => <div key={w} class="warn small">{w}</div>)}
          {error && <div class="err small">{error}</div>}
          <button disabled={!ok || runner.busy} onClick={() => void submit()}>
            Загрузить иконку
          </button>
        </div>
      </section>

      <h2>Иконки · {badges.length}</h2>
      <div class="grid">
        {badges.map(([bid, b]) => (
          <div class="tile" key={bid}>
            <div class="tile-img">{cache.images[b.img] ? <img class="badge-big" src={cache.images[b.img]} alt={b.title} /> : '…'}</div>
            <b>{b.title}</b>
            <div class="muted small">{bid}</div>
            <div class="tile-actions">
              <button class="ghost xs danger" disabled={runner.busy}
                onClick={() => confirm(`Удалить иконку «${b.title}» у всех?`) && void runner.run(`Удалена иконка ${bid}`, deleteBadge(bid))}>
                Удалить
              </button>
            </div>
          </div>
        ))}
        {!badges.length && <div class="muted">Пока пусто</div>}
      </div>
    </div>
  );
}
