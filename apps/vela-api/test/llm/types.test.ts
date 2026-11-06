import { describe, expect, test } from 'bun:test';
import {
  sanitizeProviderError,
  safeVendorCode,
  withRequestTimeout,
  REQUEST_TIMEOUT_MS,
} from '../../src/llm/types';

describe('sanitizeProviderError', () => {
  test('includes numeric HTTP status in error detail', () => {
    expect(sanitizeProviderError('OpenAI', { status: 401 })).toEqual({
      type: 'error',
      message: 'OpenAI request failed (401)',
    });
    expect(sanitizeProviderError('Google', { status: 500 })).toEqual({
      type: 'error',
      message: 'Google request failed (500)',
    });
  });

  test('does not interpolate arbitrary or secret-shaped error names', () => {
    const errorWithSecretName = { name: 'sk-SECRET-KEY-12345' };
    const result = sanitizeProviderError('OpenAI', errorWithSecretName);
    expect(result).toEqual({
      type: 'error',
      message: 'OpenAI request failed',
    });
    expect(JSON.stringify(result)).not.toContain('sk-SECRET');
  });

  test('omits detail for non-numeric status', () => {
    expect(sanitizeProviderError('Anthropic', { status: 'invalid' })).toEqual({
      type: 'error',
      message: 'Anthropic request failed',
    });
    expect(sanitizeProviderError('Anthropic', { status: NaN })).toEqual({
      type: 'error',
      message: 'Anthropic request failed',
    });
    expect(sanitizeProviderError('Anthropic', new Error('generic network error'))).toEqual({
      type: 'error',
      message: 'Anthropic request failed',
    });
    expect(sanitizeProviderError('Anthropic', null)).toEqual({
      type: 'error',
      message: 'Anthropic request failed',
    });
  });

  test('maps known timeout error classes to fixed timeout message', () => {
    expect(sanitizeProviderError('OpenAI', { name: 'TimeoutError' })).toEqual({
      type: 'error',
      message: 'OpenAI request timed out',
    });
    expect(sanitizeProviderError('Google', { name: 'AbortError' })).toEqual({
      type: 'error',
      message: 'Google request timed out',
    });
    expect(sanitizeProviderError('Anthropic', { name: 'APIUserAbortError' })).toEqual({
      type: 'error',
      message: 'Anthropic request timed out',
    });
    expect(sanitizeProviderError('OpenAI', { name: 'APIConnectionTimeoutError' })).toEqual({
      type: 'error',
      message: 'OpenAI request timed out',
    });
  });
});

describe('safeVendorCode', () => {
  const allowed = new Set(['rate_limit_exceeded', 'server_error']);

  test('preserves finite numeric codes', () => {
    expect(safeVendorCode(404, allowed)).toBe('404');
    expect(safeVendorCode(503, allowed)).toBe('503');
  });

  test('preserves allowed string codes', () => {
    expect(safeVendorCode('rate_limit_exceeded', allowed)).toBe('rate_limit_exceeded');
  });

  test('replaces untrusted string codes with unknown', () => {
    expect(safeVendorCode('sk-ATTACKER-SECRET', allowed)).toBe('unknown');
    expect(safeVendorCode('', allowed)).toBe('unknown');
  });

  test('replaces non-finite numbers or other types with unknown', () => {
    expect(safeVendorCode(Infinity, allowed)).toBe('unknown');
    expect(safeVendorCode(NaN, allowed)).toBe('unknown');
    expect(safeVendorCode(undefined, allowed)).toBe('unknown');
    expect(safeVendorCode(null, allowed)).toBe('unknown');
  });
});

describe('withRequestTimeout', () => {
  test('uses bounded request timeout constant', () => {
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(REQUEST_TIMEOUT_MS).toBeLessThan(29000);
  });

  test('returns an AbortSignal with request timeout', () => {
    const signal = withRequestTimeout();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  test('combines with caller signal when provided', () => {
    const caller = new AbortController();
    const signal = withRequestTimeout(caller.signal);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    caller.abort();
    expect(signal.aborted).toBe(true);
  });
});
