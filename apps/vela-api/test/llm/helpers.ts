import type { LlmEvent } from '@vela/common/contracts/llm';
import type { VendorEventMapper } from '../../src/llm/types';

/** Build an upstream body from raw string/byte chunks. */
export function sseBody(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

/** Drain a provider stream into an event array. */
export async function collectEvents(stream: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const events: LlmEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

/** Injectable fetch fake that also records the last request. */
export function fakeFetch(
  responder: (url: string, init: Record<string, unknown>) => Response | Promise<Response>, // eslint-disable-line no-unused-vars
): typeof fetch {
  const fetchFn = async (input: unknown, init?: unknown): Promise<Response> =>
    responder(String(input), (init ?? {}) as Record<string, unknown>);
  return fetchFn as unknown as typeof fetch;
}

/** Run a pure vendor-event mapper over fixture events, including its end() output. */
export function mapperEvents<T>(
  createMapper: () => VendorEventMapper<T>,
  vendorEvents: T[],
): LlmEvent[] {
  const mapper = createMapper();
  const events: LlmEvent[] = [];
  for (const vendorEvent of vendorEvents) events.push(...mapper.push(vendorEvent));
  events.push(...mapper.end());
  return events;
}
