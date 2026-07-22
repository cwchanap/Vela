import { Stack, StackProps, RemovalPolicy, SecretValue, CfnParameter } from 'aws-cdk-lib';
import {
  UserPool,
  UserPoolClient,
  AccountRecovery,
  OAuthScope,
  ProviderAttribute,
  UserPoolClientIdentityProvider,
  UserPoolDomain,
  UserPoolIdentityProviderGoogle,
} from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface AuthStackProps extends StackProps {}

const DEFAULT_COGNITO_DOMAIN_PREFIX = 'vela-cwchanap-auth';

const PRODUCTION_CALLBACK_URLS = ['https://vela.cwchanap.dev/auth/callback'];

const PRODUCTION_LOGOUT_URLS = ['https://vela.cwchanap.dev/auth/login'];

const LOCAL_CALLBACK_URLS = [
  'http://localhost:9000/auth/callback',
  'http://127.0.0.1:9000/auth/callback',
];

const LOCAL_LOGOUT_URLS = ['http://localhost:9000/auth/login', 'http://127.0.0.1:9000/auth/login'];

const MOBILE_OAUTH_SCHEME = 'dev.cwchanap.vela.oauth';
const DEFAULT_MOBILE_CALLBACK_URLS = [`${MOBILE_OAUTH_SCHEME}://oauth/callback`];
const DEFAULT_MOBILE_LOGOUT_URLS = [`${MOBILE_OAUTH_SCHEME}://oauth/logout`];

/**
 * Reject mobile callback/logout URIs that do not use the registered iOS scheme.
 * `parseCommaList` is permissive on its own; without this guard a typo like
 * `dev.cwchanap.vela.dev://...` would synthesise + deploy successfully and
 * then fail silently on-device because iOS would have no handler registered.
 *
 * The check is intentionally case-sensitive: the scheme registered in Info.plist
 * is `dev.cwchanap.vela.oauth` (all lowercase) and the override URIs in
 * COGNITO_MOBILE_*_URLS are project-controlled values, not free user input.
 * iOS itself lowercases custom URL schemes before dispatch, so a mixed-case
 * override would still work on-device — but accepting it here would mask a
 * config drift between CDK and Info.plist. Fail strict, fix the config.
 */
function assertMobileScheme(label: string, uris: string[]): void {
  // Scheme prefix plus a non-empty, non-whitespace path. Rejecting `scheme://`
  // (empty path) catches fat-fingered config like
  // `COGNITO_MOBILE_CALLBACK_URLS=dev.cwchanap.vela.oauth://` which would
  // synthesise + deploy but resolve to a no-op callback on-device. `\S+`
  // (not `.+`) also rejects whitespace-only paths that would slip past a
  // naive empty-path check.
  //
  // The first character after `://` must be a real path character (not `?`
  // or `#`): a query-only (`scheme://?foo`) or fragment-only (`scheme://#bar`)
  // URI has no path and would likewise dispatch to a no-op handler on-device.
  // `[^\s?#]+` for the leading path segment enforces that, while the trailing
  // `\S*` still permits a legitimate `?query` / `#fragment` after a real path.
  const schemePrefix = `${MOBILE_OAUTH_SCHEME}://`;
  const mobileUriPattern = new RegExp(
    `^${MOBILE_OAUTH_SCHEME.replace(/\./g, '\\.')}://[^\\s?#]+\\S*$`,
  );
  for (const uri of uris) {
    if (!uri.startsWith(schemePrefix)) {
      // Wrong scheme entirely (e.g. `https://...`, `dev.cwchanap.vela.dev://...`).
      // iOS only registers `dev.cwchanap.vela.oauth`, so any other scheme would
      // dispatch to a no-op handler (or another app) on-device.
      throw new Error(
        `${label} must use the ${MOBILE_OAUTH_SCHEME}:// scheme (Info.plist only registers that scheme). Got: ${uri}`,
      );
    }
    if (!mobileUriPattern.test(uri)) {
      // Right scheme but missing/invalid path: `scheme://`, `scheme:// `,
      // `scheme://?query`, `scheme://#fragment`. Cognito would store these but
      // iOS would dispatch to a no-op handler.
      throw new Error(
        `${label} must include a non-empty, non-whitespace path after ${MOBILE_OAUTH_SCHEME}:// (query-only and fragment-only URIs have no path and dispatch to a no-op handler on-device). Got: ${uri}`,
      );
    }
  }
}

function parseCommaList(value: string | undefined, defaults: string[]): string[] {
  if (!value || value.trim().length === 0) {
    return defaults;
  }
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? entries : defaults;
}

export class AuthStack extends Stack {
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;
  public readonly testUserPoolClient: UserPoolClient;
  public readonly mobileUserPoolClient: UserPoolClient;
  public readonly userPoolDomain: UserPoolDomain;
  public readonly oauthDomain: string;

  constructor(scope: Construct, id: string, props?: AuthStackProps) {
    super(scope, id, props);

    const allowLocalOAuthPlaceholders = process.env.ALLOW_LOCAL_OAUTH_PLACEHOLDERS === 'true';

    const domainPrefix = process.env.COGNITO_DOMAIN_PREFIX || DEFAULT_COGNITO_DOMAIN_PREFIX;

    const googleClientId =
      process.env.GOOGLE_OAUTH_CLIENT_ID ||
      (allowLocalOAuthPlaceholders ? 'local-synth-only.apps.googleusercontent.com' : '');
    if (!googleClientId) {
      throw new Error(
        'Missing GOOGLE_OAUTH_CLIENT_ID. Set it to your Google OAuth web client id, or set ALLOW_LOCAL_OAUTH_PLACEHOLDERS=true for local-only synth.',
      );
    }

    const googleClientSecretName =
      process.env.GOOGLE_OAUTH_CLIENT_SECRET_NAME || 'vela/google-oauth-client-secret';
    const googleClientSecretParameterProps: {
      type: string;
      noEcho: boolean;
      description: string;
      default?: string;
    } = {
      type: 'String',
      noEcho: true,
      description: 'Google OAuth web client secret supplied by GitHub Actions at deploy time.',
    };
    if (allowLocalOAuthPlaceholders) {
      googleClientSecretParameterProps.default = 'local-synth-only';
    }

    const googleClientSecretParameter = new CfnParameter(
      this,
      'GoogleOAuthClientSecret',
      googleClientSecretParameterProps,
    );
    const googleClientSecretValue = SecretValue.cfnParameter(googleClientSecretParameter);
    const googleClientSecret = new secretsmanager.Secret(this, 'VelaGoogleOAuthClientSecret', {
      secretName: googleClientSecretName,
      secretStringValue: googleClientSecretValue,
    });
    googleClientSecret.applyRemovalPolicy(RemovalPolicy.RETAIN);

    const userPool = new UserPool(this, 'VelaUserPool', {
      userPoolName: `vela-user-pool-${Stack.of(this).account}`,
      selfSignUpEnabled: false,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: false,
      },
      signInCaseSensitive: false,
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 6,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
    });

    userPool.applyRemovalPolicy(RemovalPolicy.DESTROY);

    const userPoolDomain = new UserPoolDomain(this, 'VelaUserPoolDomain', {
      userPool,
      cognitoDomain: {
        domainPrefix,
      },
    });

    const googleProvider = new UserPoolIdentityProviderGoogle(this, 'VelaGoogleProvider', {
      userPool,
      clientId: googleClientId,
      clientSecretValue: googleClientSecretValue,
      scopes: ['profile', 'email', 'openid'],
      attributeMapping: {
        email: ProviderAttribute.GOOGLE_EMAIL,
        emailVerified: ProviderAttribute.GOOGLE_EMAIL_VERIFIED,
        fullname: ProviderAttribute.GOOGLE_NAME,
        profilePicture: ProviderAttribute.GOOGLE_PICTURE,
      },
    });

    const defaultCallbackUrls = [...PRODUCTION_CALLBACK_URLS, ...LOCAL_CALLBACK_URLS];
    const defaultLogoutUrls = [...PRODUCTION_LOGOUT_URLS, ...LOCAL_LOGOUT_URLS];

    const callbackUrls = parseCommaList(process.env.COGNITO_CALLBACK_URLS, defaultCallbackUrls);
    const logoutUrls = parseCommaList(process.env.COGNITO_LOGOUT_URLS, defaultLogoutUrls);

    const userPoolClient = new UserPoolClient(this, 'VelaUserPoolClient', {
      userPool,
      userPoolClientName: 'vela-web-client',
      authFlows: {
        adminUserPassword: false,
        custom: false,
        userPassword: false,
        userSrp: false,
      },
      preventUserExistenceErrors: true,
      // enableTokenRevocation adds origin_jti/origin_iat claims to issued
      // access tokens (a token-shape change, not a runtime no-op) and enables
      // the RevokeToken endpoint for this client. Applied to every client as
      // defense-in-depth: a future revoke flow then works uniformly without a
      // per-client CDK change. Pinned by the `pins enableTokenRevocation` test.
      enableTokenRevocation: true,
      supportedIdentityProviders: [UserPoolClientIdentityProvider.GOOGLE],
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,
        },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        callbackUrls,
        logoutUrls,
      },
    });
    userPoolClient.node.addDependency(googleProvider);

    const mobileCallbackUrls = parseCommaList(
      process.env.COGNITO_MOBILE_CALLBACK_URLS,
      DEFAULT_MOBILE_CALLBACK_URLS,
    );
    const mobileLogoutUrls = parseCommaList(
      process.env.COGNITO_MOBILE_LOGOUT_URLS,
      DEFAULT_MOBILE_LOGOUT_URLS,
    );
    assertMobileScheme('COGNITO_MOBILE_CALLBACK_URLS', mobileCallbackUrls);
    assertMobileScheme('COGNITO_MOBILE_LOGOUT_URLS', mobileLogoutUrls);

    const mobileUserPoolClient = new UserPoolClient(this, 'VelaMobileUserPoolClient', {
      userPool,
      userPoolClientName: 'vela-mobile-client',
      generateSecret: false,
      // All explicit authFlows disabled, but ALLOW_REFRESH_TOKEN_AUTH is on
      // by default in Cognito and remains enabled — refresh-token rotation
      // is the intended long-lived-session path for the mobile client.
      authFlows: {
        adminUserPassword: false,
        custom: false,
        userPassword: false,
        userSrp: false,
      },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      supportedIdentityProviders: [UserPoolClientIdentityProvider.GOOGLE],
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,
        },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        callbackUrls: mobileCallbackUrls,
        logoutUrls: mobileLogoutUrls,
      },
    });
    mobileUserPoolClient.node.addDependency(googleProvider);

    // Separate client for e2e tests: enables ADMIN_USER_PASSWORD_AUTH so Playwright
    // fixtures can obtain tokens via AdminInitiateAuth without going through
    // the Google Hosted UI. Only deployed alongside the production stack —
    // the client secret is not needed; IAM permissions on the test runner
    // provide admin-level access.
    const testPoolClient = new UserPoolClient(this, 'VelaTestUserPoolClient', {
      userPool,
      userPoolClientName: 'vela-test-client',
      authFlows: {
        adminUserPassword: true,
        custom: false,
        userPassword: false,
        userSrp: false,
      },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      disableOAuth: true,
    });

    this.userPool = userPool;
    this.userPoolClient = userPoolClient;
    this.userPoolDomain = userPoolDomain;
    this.testUserPoolClient = testPoolClient;
    this.mobileUserPoolClient = mobileUserPoolClient;
    this.oauthDomain = `${domainPrefix}.auth.${Stack.of(this).region}.amazoncognito.com`;
  }
}
