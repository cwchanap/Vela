import { version as pkgVersion } from '../../package.json';
import {
  containsWhitespace,
  hasMatchingUserPoolRegion,
  isValidHostOnlyDomain,
} from '../auth/config-validators';
import { MOBILE_OAUTH_CALLBACK_URI } from '../auth/mobile-auth-contract';

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

function reportConfigIssue(
  isProd: boolean,
  productionMessage: string,
  developmentMessage: string,
): void {
  if (isProd) {
    console.error(productionMessage);
    throw new Error(productionMessage);
  }

  console.warn(developmentMessage);
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
  auth: {
    userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
    mobileClientId: import.meta.env.VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID || '',
    oauthDomain: import.meta.env.VITE_COGNITO_OAUTH_DOMAIN || '',
    region: import.meta.env.VITE_AWS_REGION || '',
    callbackUri: MOBILE_OAUTH_CALLBACK_URI,
  },
} as const;

export const validateConfig = (env?: ConfigEnv): boolean => {
  const resolvedEnv = env === undefined ? import.meta.env : env;

  if (!resolvedEnv) {
    console.warn('Environment variables not available in this context');
    return true;
  }

  const isProd = resolvedEnv.PROD === true;
  const apiUrl = resolvedEnv.VITE_MOBILE_API_URL;

  if (isMissingEnvValue(apiUrl)) {
    const msg = 'Missing required environment variable: VITE_MOBILE_API_URL';
    reportConfigIssue(
      isProd,
      msg,
      'VITE_MOBILE_API_URL not set — API calls will fail until configured.',
    );
    return true;
  }

  if (typeof apiUrl === 'string' && !isValidAbsoluteUrl(apiUrl)) {
    const msg = `VITE_MOBILE_API_URL must be a valid absolute http(s) URL, got: ${apiUrl}`;
    reportConfigIssue(isProd, msg, `VITE_MOBILE_API_URL is not a valid absolute URL: ${apiUrl}`);
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

  const requiredCognitoKeys = [
    'VITE_COGNITO_USER_POOL_ID',
    'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID',
    'VITE_COGNITO_OAUTH_DOMAIN',
    'VITE_AWS_REGION',
  ] as const;

  for (const key of requiredCognitoKeys) {
    if (isMissingEnvValue(resolvedEnv[key])) {
      const message = `Missing required environment variable: ${key}`;
      reportConfigIssue(isProd, message, `${key} not set — mobile OAuth sign-in is unavailable.`);
      return true;
    }
  }

  const userPoolId = resolvedEnv.VITE_COGNITO_USER_POOL_ID as string;
  const mobileClientId = resolvedEnv.VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID as string;
  const oauthDomain = resolvedEnv.VITE_COGNITO_OAUTH_DOMAIN as string;
  const region = resolvedEnv.VITE_AWS_REGION as string;

  for (const [key, value] of [
    ['VITE_COGNITO_USER_POOL_ID', userPoolId],
    ['VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID', mobileClientId],
    ['VITE_AWS_REGION', region],
  ] as const) {
    if (containsWhitespace(value)) {
      const message = `${key} must not contain whitespace`;
      reportConfigIssue(isProd, message, message);
      return true;
    }
  }

  if (!isValidHostOnlyDomain(oauthDomain)) {
    const message = 'VITE_COGNITO_OAUTH_DOMAIN must be a valid host-only domain';
    reportConfigIssue(isProd, message, message);
    return true;
  }

  if (!hasMatchingUserPoolRegion(userPoolId, region)) {
    const message =
      'VITE_COGNITO_USER_POOL_ID must start with the configured VITE_AWS_REGION followed by an underscore';
    reportConfigIssue(isProd, message, message);
    return true;
  }

  return true;
};
