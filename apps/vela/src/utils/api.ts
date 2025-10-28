import { config } from '../config';

/**
 * Constructs a full API URL from a relative endpoint path
 * @param endpoint - The API endpoint path (e.g., '/chat-history/save' or 'games/vocabulary')
 * @returns The full API URL using the configured base URL
 *
 * @example
 * getApiUrl('/chat-history/save') // Returns '/api/chat-history/save' in dev or production URL
 * getApiUrl('games/vocabulary') // Returns '/api/games/vocabulary'
 */
export function getApiUrl(endpoint: string): string {
  const baseUrl = config.api.url;

  // Remove leading slash from endpoint if present to avoid double slashes
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;

  // Ensure base URL ends with slash
  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  return `${cleanBaseUrl}${cleanEndpoint}`;
}
