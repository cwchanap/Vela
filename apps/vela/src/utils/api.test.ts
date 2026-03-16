import { describe, it, expect, vi } from 'vitest';

vi.mock('../config', () => ({
  config: {
    api: {
      url: '/api/',
    },
  },
}));

import { getApiUrl } from './api';

describe('getApiUrl', () => {
  it('constructs URL with leading slash stripped from endpoint', () => {
    expect(getApiUrl('/chat-history/save')).toBe('/api/chat-history/save');
  });

  it('constructs URL when endpoint has no leading slash', () => {
    expect(getApiUrl('games/vocabulary')).toBe('/api/games/vocabulary');
  });

  it('handles empty endpoint', () => {
    expect(getApiUrl('')).toBe('/api/');
  });

  it('handles endpoint with multiple path segments', () => {
    expect(getApiUrl('/my-dictionaries/123/notes')).toBe('/api/my-dictionaries/123/notes');
  });

  it('handles base URL without trailing slash', async () => {
    vi.resetModules();
    vi.doMock('../config', () => ({
      config: {
        api: {
          url: '/api',
        },
      },
    }));
    const { getApiUrl: getApiUrlNoSlash } = await import('./api');
    expect(getApiUrlNoSlash('tts/generate')).toBe('/api/tts/generate');
  });

  it('handles absolute base URL', async () => {
    vi.resetModules();
    vi.doMock('../config', () => ({
      config: {
        api: {
          url: 'https://example.com/api/',
        },
      },
    }));
    const { getApiUrl: getApiUrlAbsolute } = await import('./api');
    expect(getApiUrlAbsolute('/profiles')).toBe('https://example.com/api/profiles');
  });
});
