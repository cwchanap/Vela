import { describe, test, expect } from 'bun:test';
import { isValidBase64, readBoundedBody } from '../../src/tts/transport';

describe('isValidBase64', () => {
  test('accepts canonical padded and unpadded base64', () => {
    expect(isValidBase64('')).toBe(true);
    expect(isValidBase64('AQID')).toBe(true);
    expect(isValidBase64('AQIDBA==')).toBe(true);
    expect(isValidBase64('AQIDBAU=')).toBe(true);
  });

  test('rejects invalid characters, broken padding and trailing garbage', () => {
    for (const value of ['AQ!!I=', 'AQI', 'AQID!', 'AQID===', 'AQID====', 'AQIDBA=']) {
      expect(isValidBase64(value)).toBe(false);
    }
  });
});

describe('readBoundedBody', () => {
  test('returns a response body within the limit', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]));

    const body = await readBoundedBody(response, 3);

    expect(body.equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  test('rejects an oversized response and cancels the stream', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled = true;
      },
    });

    const error = await readBoundedBody(new Response(stream), 8).catch((failure) => failure);

    expect(error.message).toContain('too large');
    expect(cancelled).toBe(true);
  });

  test('falls back to arrayBuffer when the response has no stream', async () => {
    const response = {
      arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
    } as unknown as Response;

    expect((await readBoundedBody(response, 2)).equals(Buffer.from([1, 2]))).toBe(true);

    const oversized = {
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as Response;
    const error = await readBoundedBody(oversized, 2).catch((failure) => failure);
    expect(error.message).toContain('too large');
  });
});
