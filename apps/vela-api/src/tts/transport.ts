/**
 * Strict RFC 4648 check for the base64 forms providers actually send. Buffer's
 * decoder silently ignores invalid characters and truncates at the first bad
 * character, so malformed wire audio must be rejected before decoding.
 */
export function isValidBase64(value: string): boolean {
  return (
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  );
}

/**
 * Read a response body while enforcing a byte limit before buffering or
 * parsing. The shared request signal still bounds elapsed time; this bounds
 * allocation when upstream sends quickly but excessively.
 */
export async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const body = response.body;
  if (!body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error('TTS response too large');
    return buffer;
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('TTS response too large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, total);
}
