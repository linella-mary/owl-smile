import type { HttpClient } from 'isomorphic-git';

const TIMEOUT_MS = 120_000;

async function collect(body: AsyncIterableIterator<Uint8Array> | Uint8Array[] | undefined): Promise<Uint8Array | undefined> {
  if (!body) return undefined;
  const parts: Uint8Array[] = [];
  for await (const chunk of body) parts.push(chunk);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function* once(buf: Uint8Array): AsyncIterableIterator<Uint8Array> {
  yield buf;
}

/**
 * HTTP-клиент isomorphic-git для браузера.
 * Отличия от isomorphic-git/http/web:
 *  - credentials: 'omit' — браузер не подставляет свои учётные данные и не показывает окно входа на 401;
 *  - таймаут — запрос не может висеть бесконечно.
 */
export const webHttp: HttpClient = {
  async request({ url, method = 'GET', headers = {}, body }) {
    const data = await collect(body);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: data as BodyInit | undefined,
        credentials: 'omit',
        cache: 'no-store',
        signal: ctrl.signal,
      });
      const buf = new Uint8Array(await res.arrayBuffer());
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => (resHeaders[k] = v));
      return { url: res.url, method, statusCode: res.status, statusMessage: res.statusText, body: once(buf), headers: resHeaders };
    } catch (e) {
      if (ctrl.signal.aborted) throw new Error('Сервер GitFlic не отвечает (таймаут)');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  },
};
