import { describe, expect, test } from 'bun:test';
import { readSseDataLines } from '../../src/llm/sse';
import { sseBody } from './helpers';

async function readAll(chunks: Array<string | Uint8Array>): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of readSseDataLines(sseBody(chunks))) lines.push(line);
  return lines;
}

describe('readSseDataLines', () => {
  test('yields data payloads and skips non-data lines', async () => {
    expect(await readAll(['data: {"a":1}\n\nevent: foo\n: comment\ndata: {"b":2}\n\n'])).toEqual([
      '{"a":1}',
      '{"b":2}',
    ]);
  });

  test('reassembles data lines split across chunk boundaries', async () => {
    expect(await readAll(['data: {"a"', ':1}\ndata: {"b"', ':2}\n\n'])).toEqual([
      '{"a":1}',
      '{"b":2}',
    ]);
  });

  test('processes trailing data at EOF without a final newline', async () => {
    expect(await readAll(['data: {"a":1}\ndata: {"b":2}'])).toEqual(['{"a":1}', '{"b":2}']);
  });

  test('decodes multi-byte UTF-8 characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: こんにちは\n\n');
    const chunks = [bytes.slice(0, 7), bytes.slice(7, 12), bytes.slice(12)];
    expect(await readAll(chunks)).toEqual(['こんにちは']);
  });

  test('handles CRLF line endings and skips empty data lines', async () => {
    expect(await readAll(['data: {"a":1}\r\ndata: \r\n'])).toEqual(['{"a":1}']);
  });

  test('yields the openrouter DONE marker for callers to filter', async () => {
    expect(await readAll(['data: {"a":1}\n\ndata: [DONE]\n\n'])).toEqual(['{"a":1}', '[DONE]']);
  });

  test('empty body yields nothing', async () => {
    expect(await readAll([''])).toEqual([]);
  });
});
