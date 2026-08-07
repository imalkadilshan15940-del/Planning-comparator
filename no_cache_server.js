#!/usr/bin/env node
/**
 * No-cache local server for the Planning Comparator app — Node.js version.
 *
 * Equivalent to no_cache_server.py: serves the current directory, with
 * every response including headers that stop the browser from caching JS
 * modules (the same staleness issue that motivated the Python version),
 * and explicit UTF-8 charset declarations. Uses only Node's built-in
 * modules — no npm install, no dependencies.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 3000;
const ROOT = process.cwd();

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  if (mime.startsWith('text/') || mime === 'application/javascript' || mime === 'application/json') {
    return `${mime}; charset=utf-8`;
  }
  return mime;
}

const server = http.createServer((req, res) => {
  // Strip query string, decode URL-encoded characters, prevent path traversal.
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    const headers = {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    };

    if (err) {
      res.writeHead(404, headers);
      res.end('404 Not Found');
      return;
    }

    headers['Content-Type'] = contentTypeFor(filePath);
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Serving with caching disabled at http://localhost:${PORT}`);
  console.log('Keep this window open. Press Ctrl+C to stop.');
});
