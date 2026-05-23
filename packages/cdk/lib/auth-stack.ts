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

    const defaultCallbackUrls = [
      ...PRODUCTION_CALLBACK_URLS,
      ...(allowLocalOAuthPlaceholders ? LOCAL_CALLBACK_URLS : []),
    ];
    const defaultLogoutUrls = [
      ...PRODUCTION_LOGOUT_URLS,
      ...(allowLocalOAuthPlaceholders ? LOCAL_LOGOUT_URLS : []),
    ];

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
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      disableOAuth: true,
    });

    this.userPool = userPool;
    this.userPoolClient = userPoolClient;
    this.userPoolDomain = userPoolDomain;
    this.testUserPoolClient = testPoolClient;
    this.oauthDomain = `${domainPrefix}.auth.${Stack.of(this).region}.amazoncognito.com`;
  }
}
