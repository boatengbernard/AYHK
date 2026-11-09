import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { sampleData } from '../src/shared/sample.ts';
import { createApp } from './app.ts';
import { Store } from './db.ts';

const PORT = Number(process.env.PORT ?? 8080);
const DATA_FILE = resolve(process.env.AYHK_DATA_FILE ?? 'server/data/ayhk.json');
const DIST = resolve('dist');
const partner = process.env.AYHK_PARTNER_KEY ?? 'dev-partner-key';
const kiosk = process.env.AYHK_KIOSK_KEY ?? 'dev-kiosk-key';
const seedSample = process.env.AYHK_SEED_SAMPLE === '1';

if (!process.env.AYHK_PARTNER_KEY || !process.env.AYHK_KIOSK_KEY)
  console.warn('⚠ Using development keys. Set AYHK_PARTNER_KEY and AYHK_KIOSK_KEY before going live.');

const store = new Store(DATA_FILE, seedSample ? () => ({ ...sampleData(), pilotRequests: [] }) : undefined);
const handle = createApp(store, { partner, kiosk });

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const cors = {
    'access-control-allow-origin': process.env.AYHK_CORS_ORIGIN ?? '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };

  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    let body: unknown = undefined;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 2_000_000) return res.writeHead(413, cors).end();
        chunks.push(c);
      }
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      } catch {
        res.writeHead(400, { ...cors, 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Body must be JSON.' }));
      }
    }
    const out = handle({ method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, headers: req.headers as Record<string, string>, body });
    res.writeHead(out.status, { ...cors, 'content-type': 'application/json', ...out.headers });
    return res.end(JSON.stringify(out.body));
  }

  // Static files from the production build: / (website), /kiosk/, /dashboard/
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end(existsSync(DIST) ? 'Not found' : 'Run `npm run build` first to serve the apps.');
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`AYHK server on http://localhost:${PORT}`);
  console.log(`  website    http://localhost:${PORT}/`);
  console.log(`  kiosk      http://localhost:${PORT}/kiosk/`);
  console.log(`  dashboard  http://localhost:${PORT}/dashboard/`);
  console.log(`  data file  ${DATA_FILE}`);
});
