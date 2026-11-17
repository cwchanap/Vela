import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const distDir = fileURLToPath(new URL('../dist/spa/', import.meta.url));
const hasBuild = existsSync(join(distDir, 'index.html'));

// The production build is created by `bun run build`; other e2e configs run
// against the dev server and do not need it.
test.skip(!hasBuild, 'Requires a production build: cd apps/vela && bun run build');

const contentTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.gz': 'application/octet-stream',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    } catch {
      response.writeHead(400).end('bad request');
      return;
    }

    const filePath = join(distDir, pathname === '/' ? 'index.html' : pathname);
    const relativePath = relative(distDir, filePath);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      response.writeHead(403).end('forbidden');
      return;
    }

    try {
      const body = await readFile(filePath);
      response.writeHead(200, {
        'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Failed to determine built-tokenizer server port');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
});

test('rejects encoded traversal outside the build directory and keeps 404s', async ({
  request,
}) => {
  const traversal = await request.get(`${baseUrl}/%2e%2e%2f%2e%2e%2fpackage.json`);
  expect(traversal.status()).toBe(403);
  expect(await traversal.text()).not.toContain('"name": "@vela/app"');

  const missing = await request.get(`${baseUrl}/missing-asset.js`);
  expect(missing.status()).toBe(404);
});

test('returns 400 for malformed URL escapes', async ({ request }) => {
  const malformed = await request.get(`${baseUrl}/%`);
  expect(malformed.status()).toBe(400);
});

test('built tokenizer chunk loads and tokenizes in a browser', async ({ page }) => {
  const tokenizerChunk = (await readdir(join(distDir, 'assets'))).find(
    (name) => name.startsWith('tokenizer-') && name.endsWith('.js'),
  );
  expect(tokenizerChunk, 'tokenizer chunk missing from dist/spa/assets').toBeTruthy();

  const zlibErrors: string[] = [];
  page.on('pageerror', (error) => {
    if (error.message.includes("'Zlib' in undefined")) zlibErrors.push(error.message);
  });

  await page.goto(`${baseUrl}/`);
  const tokens = await page.evaluate(async (chunkName) => {
    const module = await import(`/assets/${chunkName}`);
    module.t('/kuromoji-dict');
    return (await module.n('猫が好きです。')).map(
      (token: { surface_form: string; reading: string }) =>
        `${token.surface_form}:${token.reading}`,
    );
  }, tokenizerChunk);

  expect(tokens).toEqual(['猫:ネコ', 'が:ガ', '好き:スキ', 'です:デス', '。:。']);
  expect(zlibErrors).toEqual([]);
});
