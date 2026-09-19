/**
 * Zero-dependency static file server.
 *
 * Playwright boots this as its `webServer` (see playwright.config.js) so the
 * tests exercise the real files through real HTTP — same MIME types and same
 * directory-index behaviour a static host applies. No build step, no npm dep,
 * so it can never drift or fail to install in CI.
 *
 *   node tests/serve.js --port 4173 --host 127.0.0.1
 *
 * Document root is the repository root (one level up from this file).
 */
import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '4173' },
    host: { type: 'string', default: '127.0.0.1' },
  },
});

const PORT = Number(process.env.PORT ?? values.port);
const HOST = values.host;

/** Map a request path onto an absolute path inside ROOT, or null if it escapes. */
function resolveWithinRoot(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(requestUrl ?? '/', 'http://localhost').pathname,
    );
  } catch {
    return null;
  }

  const relative = path.posix.normalize(pathname).replace(/^(\.\.\/+)+/, '');
  const absolute = path.resolve(ROOT, `.${relative.startsWith('/') ? relative : `/${relative}`}`);

  // Block traversal (and anything outside the document root) outright.
  if (absolute !== ROOT && !absolute.startsWith(ROOT + path.sep)) return null;
  return absolute;
}

async function statFile(target) {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    let target = resolveWithinRoot(req.url);
    if (target === null) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    let stats = await statFile(target);
    if (stats?.isDirectory()) {
      target = path.join(target, 'index.html');
      stats = await statFile(target);
    }

    if (!stats?.isFile()) {
      const fallback = await fs.readFile(path.join(ROOT, '404.html')).catch(() => null);
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fallback ?? 'Not Found');
      return;
    }

    const headers = {
      'content-type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(stats.size),
      'cache-control': 'no-store',
    };

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    createReadStream(target).pipe(res);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
    console.error(`[serve] ${req.method} ${req.url} ->`, error);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[serve] ${ROOT} on http://${HOST}:${PORT}`);
});
