// A static file server for development, whose only job beyond serving files is
// refusing to let anything be cached.
//
// It exists because `python -m http.server` sends no cache headers at all, and a
// browser given no headers falls back to heuristic caching: it guessed that the
// ES modules were fresh and kept serving an old build out of memory. A change
// was edited, saved, served correctly by the server, fetched into a brand new
// tab — and the page still ran the previous version. Half an hour was spent
// testing code that was not the code on disk.
//
// `no-store` is stronger than `no-cache` on purpose. `no-cache` still stores the
// response and revalidates; `no-store` keeps it out of the cache entirely, which
// is the only thing that reliably survives a browser deciding it knows better.
//
// Run through `.claude/launch.json`, or directly with `node scripts/dev-server.js`.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PORT) || 8000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (request, response) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);
  const wanted = pathname.endsWith('/') ? `${pathname}index.html` : pathname;

  // Resolved and then checked against the root, so a path that climbs out with
  // `..` is refused rather than served.
  const file = join(ROOT, normalize(wanted));
  if (!file.startsWith(ROOT)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      // The whole point of this file.
      'Cache-Control': 'no-store, must-revalidate',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not found');
  }
}).listen(PORT, () => {
  console.log(`serving ${ROOT} on http://localhost:${PORT} with caching off`);
});
