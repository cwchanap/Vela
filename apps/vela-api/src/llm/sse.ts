/**
 * Minimal shared SSE reader for the fetch-based Google and OpenRouter
 * upstreams. Extracted from the old dictionary route so its UTF-8 buffering
 * and EOF flush exist exactly once; yields `data:` payload strings (including
 * the OpenRouter `[DONE]` marker — callers filter) and skips every other
 * line kind.
 */
export async function* readSseDataLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const drainCompleteLines = function* (): Generator<string> {
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const payload = dataPayload(line);
      if (payload !== null) yield payload;
      newline = buffer.indexOf('\n');
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      yield* drainCompleteLines();
    }
    // Flush the TextDecoder; without this a trailing multi-byte character
    // split across chunks would be lost.
    buffer += decoder.decode();
    yield* drainCompleteLines();
    // Trailing data at EOF without a final newline must still be processed.
    if (buffer) {
      const payload = dataPayload(buffer);
      buffer = '';
      if (payload !== null) yield payload;
    }
  } finally {
    reader.releaseLock();
  }
}

/** SSE `data:` payload of one line, or null when the line carries no payload. */
function dataPayload(line: string): string | null {
  const withoutCr = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (!withoutCr.startsWith('data:')) return null;
  const payload = withoutCr.slice('data:'.length).replace(/^ /, '').trim();
  return payload === '' ? null : payload;
}
