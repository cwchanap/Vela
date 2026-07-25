import { version as pkgVersion } from '../../package.json';

type ConfigEnv = Record<string, unknown> | null | undefined;

const isMissingEnvValue = (value: unknown): boolean => {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
};

function isValidAbsoluteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname;
  } catch {
    return false;
  }
}

export const config = {
  app: {
    name: import.meta.env.VITE_APP_NAME || 'Vela',
    version: import.meta.env.VITE_APP_VERSION || pkgVersion,
    isDev: import.meta.env.DEV,
    isProd: import.meta.env.PROD,
  },
  api: {
    url: import.meta.env.VITE_MOBILE_API_URL || '',
  },
} as const;

export const validateConfig = (env?: ConfigEnv): boolean => {
  const resolvedEnv = env === undefined ? import.meta.env : env;

  if (!resolvedEnv) {
    console.warn('Environment variables not available in this context');
    return true;
  }

  const apiUrl = resolvedEnv.VITE_MOBILE_API_URL;
  const isProd = resolvedEnv.PROD === true;

  if (isMissingEnvValue(apiUrl)) {
    const msg = 'Missing required environment variable: VITE_MOBILE_API_URL';
    if (isProd) {
      console.error(msg);
      throw new Error(msg);
    }
    console.warn('VITE_MOBILE_API_URL not set — API calls will fail until configured.');
    return true;
  }

  if (typeof apiUrl === 'string' && !isValidAbsoluteUrl(apiUrl)) {
    const msg = `VITE_MOBILE_API_URL must be a valid absolute http(s) URL, got: ${apiUrl}`;
    if (isProd) {
      console.error(msg);
      throw new Error(msg);
    }
    console.warn(`VITE_MOBILE_API_URL is not a valid absolute URL: ${apiUrl}`);
    return true;
  }

  // Reject plain http: in production. ATS enforcement depends on this — even
  // if an ATS exception leaked into a Release build (or an operator configures
  // an HTTP endpoint), the app must crash at boot rather than silently load
  // over HTTP. Dev builds may target http://localhost or LAN IPs.
  if (isProd && typeof apiUrl === 'string' && new URL(apiUrl).protocol === 'http:') {
    const msg = `VITE_MOBILE_API_URL must be https: in production, got: ${apiUrl}`;
    console.error(msg);
    throw new Error(msg);
  }

  return true;
};
