import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'build/web-tuan42');
const port = Number(process.argv[3] ?? 18087);
const vatExportRoot = resolve(process.argv[4] ?? 'assets/resources/vat/nanwuzhe');
const host = process.argv[5] ?? '127.0.0.1';
const mime = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
  if (request.method === 'POST' && url.pathname === '/__vat_export') {
    const name = url.searchParams.get('name') ?? '';
    if (!/^[a-z0-9][a-z0-9.-]*$/i.test(name)) {
      response.writeHead(400).end('Invalid export name');
      return;
    }
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024 * 1024) request.destroy();
      else chunks.push(chunk);
    });
    request.on('end', () => {
      mkdirSync(vatExportRoot, { recursive: true });
      const output = join(vatExportRoot, name);
      writeFileSync(output, Buffer.concat(chunks));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ output, size }));
    });
    return;
  }
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = resolve(join(root, relative || 'index.html'));
  if (!file.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, host, () => {
  console.log(`[StaticServer] ${root} -> http://${host}:${port}`);
});
