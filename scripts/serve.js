// Minimaler statischer Webserver für lokale Entwicklung und Tests (keine Abhängigkeiten).
// Aufruf: node scripts/serve.js [port] [basis]   → http://localhost:8080/
//         node scripts/serve.js 8080 /Arbeitszeit/ → wie GitHub Pages unter http://localhost:8080/Arbeitszeit/
// localhost gilt im Browser als „sicherer Kontext“: Service Worker und Installation funktionieren dort.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../app/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

/**
 * @param base       URL-Präfix, unter dem die App liegt (z. B. "/Arbeitszeit/" wie bei GitHub Pages)
 * @param overrides  Map relativer Pfad → Inhalt; ersetzt Dateien (für Tests, z. B. neue sw.js-Version)
 * @param root       App-Verzeichnis (Text oder Funktion, die es liefert – z. B. für Update-Tests mit
 *                   einer älteren Version); Standard: ../app/
 */
export function createServer({ base = '/', overrides = new Map(), root = ROOT } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const full = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (full === base.replace(/\/$/, '') && base !== '/') {
        res.writeHead(301, { Location: base }).end();
        return;
      }
      if (!full.startsWith(base)) throw new Error('außerhalb');
      const path = full.slice(base.length);
      if (overrides.has(path)) {
        res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'text/plain', 'Cache-Control': 'no-cache' });
        res.end(overrides.get(path));
        return;
      }
      const dir = typeof root === 'function' ? root() : root;
      let file = normalize(join(dir, path));
      if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
      if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2]) || 8080;
  const base = process.argv[3] || '/';
  createServer({ base }).listen(port, () => console.log(`Arbeitszeit läuft auf http://localhost:${port}${base}`));
}
