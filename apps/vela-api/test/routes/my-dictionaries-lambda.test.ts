import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Real Node regression for the deployed Lambda path: the API's Lambda runtime
 * is NODEJS_20_X and `hono/aws-lambda` serializes the route Response with
 * `await res.text()`, which rejects ReadableStreams enqueuing strings
 * ("Received non-Uint8Array chunk"). Bun tolerates string chunks, so only an
 * actual `node` child process reproduces the deployed failure. The fixture
 * bundles the real route serializer + real hono/aws-lambda adapter via
 * Bun.build; the driver invokes the handler with a v1 API Gateway event.
 */

const DRIVER = `
const [, , bundlePath] = process.argv;
const { handler } = await import(bundlePath);
const headers = { host: 'localhost.execute-api.us-east-1.amazonaws.com' };
const res = await handler(
  {
    httpMethod: 'POST',
    path: '/analyze',
    headers,
    body: '',
    isBase64Encoded: false,
    requestContext: { domainName: 'localhost.execute-api.us-east-1.amazonaws.com' },
  },
  {},
);
console.log('RESULT:' + JSON.stringify({ statusCode: res.statusCode, body: res.body, isBase64Encoded: !!res.isBase64Encoded }));
`.trimStart();

describe('dictionary SSE through the real Node Lambda adapter', () => {
  test('handler serializes the analysis SSE body under Node (byte chunks required)', async () => {
    const nodeCheck = spawnSync('node', ['--version'], { encoding: 'utf8' });
    if (nodeCheck.error || nodeCheck.status !== 0) {
      throw new Error(
        'node is required for the Lambda adapter regression: ' + String(nodeCheck.error),
      );
    }

    const outDir = mkdtempSync(join(tmpdir(), 'lambda-sse-regression-'));
    try {
      // `bun build` CLI (the Bun.build API misresolves relative imports when
      // invoked from a nested test file); bundles the real route module graph.
      const build = spawnSync(
        'bun',
        [
          'build',
          join(import.meta.dir, '../fixtures/lambda-sse-entry.ts'),
          '--target=node',
          '--format=esm',
          `--outdir=${outDir}`,
        ],
        { encoding: 'utf8', timeout: 120_000 },
      );
      if (build.status !== 0) {
        throw new Error('fixture bundle failed: ' + build.stdout + build.stderr);
      }

      const bundlePath = join(outDir, 'lambda-sse-entry.js');
      if (!existsSync(bundlePath)) throw new Error('fixture bundle not found at ' + bundlePath);

      const driverPath = join(outDir, 'driver.mjs');
      writeFileSync(driverPath, DRIVER);

      const run = spawnSync('node', [driverPath, bundlePath], {
        encoding: 'utf8',
        timeout: 60_000,
      });
      if (run.status !== 0) {
        throw new Error('node driver failed: ' + run.stderr);
      }
      expect(run.status).toBe(0);

      const line = run.stdout.split('\n').find((l) => l.startsWith('RESULT:'));
      expect(line).toBeTruthy();
      const result = JSON.parse(line!.slice('RESULT:'.length));
      // hono/aws-lambda marks text/event-stream as binary content and returns
      // a base64 body (API Gateway decodes it for clients) — decode to assert
      // the real frame bytes.
      const body = result.isBase64Encoded
        ? Buffer.from(result.body, 'base64').toString('utf8')
        : result.body;
      expect(result.statusCode).toBe(200);
      expect(body).toContain('"type":"metadata"');
      expect(body).toContain('"type":"chunk","text":"こんにちは"');
      expect(body.trimEnd().endsWith('"type":"done"}'));
      // Sanity: no error frame reached the serialized body.
      expect(body).not.toContain('"type":"error"');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);
});
