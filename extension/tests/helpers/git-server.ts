import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

/** Ключ записи, который принимает тестовый сервер. */
export const TEST_KEY = 'owl-e2e-key-7f3a91';

/** Локальный smart-HTTP git-сервер на `git http-backend` (для интеграционных тестов). */
export async function startGitServer(seed: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-git-'));
  const bare = path.join(root, 'owner', 'data.git');
  const run = (args: string[], cwd = root) => execFileSync('git', args, { cwd, stdio: 'pipe' });

  run(['init', '--bare', '-b', 'master', bare]);
  run(['config', 'http.receivepack', 'true'], bare);
  const work = path.join(root, 'seed');
  run(['init', '-b', 'master', work]);
  for (const [file, content] of Object.entries(seed)) {
    fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
    fs.writeFileSync(path.join(work, file), content);
  }
  run(['add', '-A'], work);
  run(['-c', 'user.name=seed', '-c', 'user.email=seed@x', 'commit', '-m', 'seed'], work);
  run(['push', bare, 'master'], work);

  const server = http.createServer((req, res) => {
    // Ведём себя как GitFlic: 401 на POST без User-Agent и на push без авторизации.
    const isPush = /git-receive-pack/.test(req.url ?? '');
    const goodAuth = `Basic ${Buffer.from(`tester:${TEST_KEY}`).toString('base64')}`;
    if (
      (req.method === 'POST' && !req.headers['user-agent']) ||
      (isPush && req.headers.authorization !== goodAuth)
    ) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' });
      res.end();
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? '/', 'http://x');
      // /project/<owner>/<repo>.git/... → /<owner>/<repo>.git/...
      const pathInfo = decodeURIComponent(url.pathname.replace(/^\/project/, ''));
      const cgi = spawn('git', ['http-backend'], {
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: root,
          GIT_HTTP_EXPORT_ALL: '1',
          REMOTE_USER: 'tester',
          REQUEST_METHOD: req.method ?? 'GET',
          PATH_INFO: pathInfo,
          QUERY_STRING: url.search.slice(1),
          CONTENT_TYPE: req.headers['content-type'] ?? '',
          CONTENT_LENGTH: String(body.length),
          HTTP_CONTENT_ENCODING: String(req.headers['content-encoding'] ?? ''),
          GIT_PROTOCOL: String(req.headers['git-protocol'] ?? ''),
        },
      });
      const out: Buffer[] = [];
      cgi.stdout.on('data', (c) => out.push(c));
      cgi.on('close', () => {
        const buf = Buffer.concat(out);
        const sep = buf.indexOf('\r\n\r\n');
        const head = buf.subarray(0, sep).toString();
        let status = 200;
        const headers: Record<string, string> = {};
        for (const line of head.split('\r\n')) {
          const i = line.indexOf(':');
          const k = line.slice(0, i).trim();
          const v = line.slice(i + 1).trim();
          if (k.toLowerCase() === 'status') status = parseInt(v, 10);
          else headers[k] = v;
        }
        res.writeHead(status, headers);
        res.end(buf.subarray(sep + 4));
      });
      cgi.stdin.end(body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  return {
    root,
    /** Базовый URL, подставляется вместо https://gitflic.ru */
    origin: `http://127.0.0.1:${port}`,
    /** Список файлов в ветке master на сервере. */
    files: () => run(['ls-tree', '-r', '--name-only', 'master'], bare).toString().trim().split('\n'),
    log: () => run(['log', '--format=%s', 'master'], bare).toString().trim().split('\n'),
    /** Содержимое файла в ветке master. */
    show: (file: string): Buffer => run(['show', `master:${file}`], bare),
    async close() {
      await new Promise((r) => server.close(r));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
