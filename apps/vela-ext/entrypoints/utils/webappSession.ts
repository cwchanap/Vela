import { checkSession, refreshToken, type AuthTokens } from './api';
import { saveAuthTokens } from './storage';

export interface WebappSession {
  tokens: AuthTokens;
  email: string | null;
}

export const WEBAPP_URL_PATTERNS = [
  'https://vela.cwchanap.dev/*',
  'http://localhost:9000/*',
  'http://127.0.0.1:9000/*',
];

function getWebappBaseUrl(): string {
  return import.meta.env.MODE === 'development'
    ? 'http://localhost:9000'
    : 'https://vela.cwchanap.dev';
}

export function getWebappLoginUrl(): string {
  return `${getWebappBaseUrl()}/auth/login`;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1];
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractEmailFromIdToken(idToken: string, fallbackUsername: string): string | null {
  const payload = decodeJwtPayload(idToken);
  const email = payload?.email;

  if (typeof email === 'string' && email.length > 0) {
    return email;
  }

  return fallbackUsername.includes('@') ? fallbackUsername : null;
}

function isCompleteTokenSet(value: Partial<AuthTokens>): value is AuthTokens {
  return (
    typeof value.accessToken === 'string' &&
    value.accessToken.length > 0 &&
    typeof value.refreshToken === 'string' &&
    value.refreshToken.length > 0 &&
    typeof value.idToken === 'string' &&
    value.idToken.length > 0
  );
}

export function readCognitoSessionFromStorage(
  storage: Storage = window.localStorage,
): WebappSession | null {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith('CognitoIdentityServiceProvider.') || !key.endsWith('.LastAuthUser')) {
      continue;
    }

    const username = storage.getItem(key);
    if (!username) continue;

    const baseKey = key.slice(0, -'.LastAuthUser'.length);
    const tokens: Partial<AuthTokens> = {
      accessToken: storage.getItem(`${baseKey}.${username}.accessToken`) ?? undefined,
      refreshToken: storage.getItem(`${baseKey}.${username}.refreshToken`) ?? undefined,
      idToken: storage.getItem(`${baseKey}.${username}.idToken`) ?? undefined,
    };

    if (!isCompleteTokenSet(tokens)) continue;

    return {
      tokens,
      email: extractEmailFromIdToken(tokens.idToken, username),
    };
  }

  return null;
}

function isWebappSession(value: unknown): value is WebappSession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<WebappSession>;

  return (
    typeof candidate.tokens === 'object' &&
    candidate.tokens !== null &&
    isCompleteTokenSet(candidate.tokens) &&
    (typeof candidate.email === 'string' || candidate.email === null)
  );
}

export async function importWebappSession(): Promise<boolean> {
  const tabs = await browser.tabs.query({ url: WEBAPP_URL_PATTERNS });
  const orderedTabs = [...tabs].sort(
    (a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)),
  );

  for (const tab of orderedTabs) {
    if (typeof tab.id !== 'number') continue;

    let session: unknown;
    try {
      session = await browser.tabs.sendMessage(tab.id, { type: 'GET_VELA_WEBAPP_SESSION' });
    } catch {
      // A Vela tab might exist before the content script is ready. Try the next tab.
      continue;
    }

    if (!isWebappSession(session)) continue;

    const isValid = await checkSession(session.tokens.idToken);
    if (!isValid) {
      // ID token may be expired — try refreshing with the refresh token
      // before skipping, since the user may still be signed in on the web app
      try {
        const newTokens = await refreshToken(session.tokens.refreshToken);
        await saveAuthTokens(newTokens, session.email ?? undefined);
        return true;
      } catch {
        continue;
      }
    }

    await saveAuthTokens(session.tokens, session.email ?? undefined);
    return true;
  }

  return false;
}

export async function openWebappLogin(): Promise<void> {
  await browser.tabs.create({ url: getWebappLoginUrl() });
}
