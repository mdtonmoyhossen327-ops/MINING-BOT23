import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { application } from './functions/routes.mjs';
import { createPgDb } from './db-pg.mjs';

class BackendError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

const PORT = Number(process.env.PORT || 8787);
const ROOT = fileURLToPath(new URL('./web/', import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

const handle = application({
  db: createPgDb(process.env.DATABASE_URL, process.env.DATABASE_SSL === '1'),
  env: {
    BOT_TOKEN: process.env.BOT_TOKEN || '',
    ADMIN_IDS: process.env.ADMIN_IDS || '',
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || '',
  },
  BackendError,
});

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let path = url.pathname;
  if (path.startsWith('/api/') || path === '/webhook') path = '/functions/v1/app' + path;

  if (path.startsWith('/functions/v1/app')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(new URL(path + url.search, url.origin), {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    try {
      const out = await handle({ request });
      const buf = Buffer.from(await out.arrayBuffer());
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(buf);
    } catch (e) {
      res.writeHead(e.status || 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: e.code || 'internal' }));
    }
    return;
  }

  let rel = normalize(path).replace(/^([/\\])+/, '');
  if (rel === '' || rel === '.') rel = 'index.html';
  const file = join(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`listening on ${PORT}`));