import { useEffect, useState } from 'preact/hooks';
import { EMOTE_CODE_RE, isRiskyCode } from '../../shared/ids';
import { prepareImage, type PrepareResult } from '../image';
import { addEmote, deleteEmote, renameEmote, UserError, type Actor } from '../ops';
import { DropZone, useRunner, type CacheView } from './common';

function UploadEmote({ author }: { author: string }) {
  const runner = useRunner();
  const [code, setCode] = useState('');
  const [prepared, setPrepared] = useState<PrepareResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const onFile = async (f: File) => {
    setError('');
    setPrepared(null);
    setPreview(null);
    setWorking(true);
    try {
      const p = await prepareImage(f, 'emote');
      setPrepared(p);
      setPreview(URL.createObjectURL(new Blob([p.bytes as Uint8Array<ArrayBuffer>], { type: p.path.endsWith('.gif') ? 'image/gif' : 'image/webp' })));
      if (!code) setCode(f.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 25));
    } catch (e) {
      setError(e instanceof UserError ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };

  const codeOk = EMOTE_CODE_RE.test(code);
  const submit = async () => {
    if (!prepared || !codeOk) return;
    if (await runner.run(`Добавлен смайл ${code}`, addEmote(code, prepared, author))) {
      setCode('');
      setPrepared(null);
      setPreview(null);
    }
  };

  return (
    <section class="card upload">
      <DropZone
        onFile={(f) => void onFile(f)}
        preview={preview}
        hint={working ? 'Обработка…' : <>Перетащите картинку сюда<br />или нажмите, чтобы выбрать<br /><br />PNG, JPEG, GIF, WebP до 5 МБ<br />лучше квадрат от 112×112</>}
      />
      <div class="stack grow">
        <label class="field">
          <span>Код смайла (его пишут в чат)</span>
          <input value={code} maxLength={25} placeholder="CatJam" onInput={(e) => setCode(e.currentTarget.value.trim())} />
        </label>
        {code && !codeOk && <div class="err small">3–25 символов: латиница, цифры, _</div>}
        {codeOk && isRiskyCode(code) && (
          <div class="warn small">Код из одних строчных букв совпадёт с обычным словом в чате — лучше с заглавной: {code[0]!.toUpperCase() + code.slice(1)}</div>
        )}
        {prepared && (
          <div class="row preview-row">
            <span class="muted small">В чате:</span>
            <span class="chat-sample">
              привет <img class="owl-emote" src={preview!} alt={code} /> всем
            </span>
            <span class="muted small" title="исходник → сохранится">
              {prepared.srcW}×{prepared.srcH} → {prepared.w}×{prepared.h}
              {prepared.animated ? ` · анимация${prepared.frames ? `, ${prepared.frames} кадров` : ''}` : ''} ·{' '}
              {Math.ceil(prepared.bytes.length / 1024)} КБ
            </span>
          </div>
        )}
        {prepared?.warnings.map((w) => <div key={w} class="warn small">{w}</div>)}
        {error && <div class="err small">{error}</div>}
        <button disabled={!prepared || !codeOk || runner.busy} onClick={() => void submit()}>
          Загрузить в общую базу
        </button>
      </div>
    </section>
  );
}

function EmoteCard({ code, src, author, actor }: { code: string; src?: string; author: string; actor: Actor }) {
  // Чужие смайлы правит только админ (операции проверяют это и сами)
  const mine = actor.admin || author.trim().toLowerCase() === actor.nick.trim().toLowerCase();
  const runner = useRunner();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(code);
  const [copied, setCopied] = useState(false);

  return (
    <div class="tile">
      <div class="tile-img">{src ? <img src={src} alt={code} /> : '…'}</div>
      {renaming ? (
        <input class="tile-input" value={name} autoFocus onInput={(e) => setName(e.currentTarget.value.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setRenaming(false);
            if (e.key === 'Enter' && name !== code)
              void runner.run(`Смайл ${code} → ${name}`, renameEmote(code, name, actor)).then((ok) => ok && setRenaming(false));
          }}
        />
      ) : (
        <button class="tile-code" title="Скопировать код" onClick={() => void navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1000); })}>
          {copied ? 'скопировано' : code}
        </button>
      )}
      <div class="muted small">от {author}</div>
      {mine && <div class="tile-actions">
        <button class="ghost xs" disabled={runner.busy} onClick={() => { setName(code); setRenaming(!renaming); }}>
          {renaming ? 'Отмена' : 'Переименовать'}
        </button>
        <button class="ghost xs danger" disabled={runner.busy}
          onClick={() => confirm(`Удалить смайл ${code} у всех?`) && void runner.run(`Удалён смайл ${code}`, deleteEmote(code, actor))}>
          Удалить
        </button>
      </div>}
    </div>
  );
}

export function EmotesTab({ cache, author, actor }: { cache: CacheView; author: string; actor: Actor }) {
  const [q, setQ] = useState('');
  const emotes = Object.entries(cache.index?.emotes ?? {})
    .filter(([code]) => code.toLowerCase().includes(q.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div class="stack">
      <UploadEmote author={author} />
      <div class="row">
        <h2 class="grow">Смайлы · {Object.keys(cache.index?.emotes ?? {}).length}</h2>
        <input placeholder="Поиск" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      </div>
      <div class="grid">
        {emotes.map(([code, e]) => (
          <EmoteCard key={code} code={code} src={cache.images[e.img]} author={e.author} actor={actor} />
        ))}
        {!emotes.length && <div class="muted">Пока пусто</div>}
      </div>
    </div>
  );
}
