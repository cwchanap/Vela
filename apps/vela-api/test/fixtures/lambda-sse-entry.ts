/**
 * Entry for the real-Node Lambda adapter regression. Bundles the REAL
 * dictionary SSE serializer (exported from the route) into a hono/aws-lambda
 * handler that the test then invokes with an actual `node` process — the
 * Lambda runtime is NODEJS_20_X, whose `res.text()` consumption rejects
 * string-enqueued ReadableStreams ("Received non-Uint8Array chunk"), so this
 * is the only environment class that catches that defect.
 */
import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import type { LlmEvent } from '@vela/common/contracts/llm';
import { isLambdaContentTypeBinary } from '../../src/lambda-adapter';
import { createAnalysisSseStream } from '../../src/routes/my-dictionaries';

async function* upstream(): AsyncIterable<LlmEvent> {
  yield { type: 'text', text: 'こんにちは' };
}

const app = new Hono();
app.post('/analyze', () => {
  return new Response(
    createAnalysisSseStream(upstream(), {
      provider: 'google',
      model: 'gemini-3.8-flash',
      sentence: 'こんにちは',
    }),
    { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } },
  );
});

export const handler = handle(app, { isContentTypeBinary: isLambdaContentTypeBinary });
