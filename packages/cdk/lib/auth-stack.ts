import { Stack, StackProps, RemovalPolicy, SecretValue } from 'aws-cdk-lib';
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
import { Construct } from 'constructs';

export interface AuthStackProps extends StackProps {}

export class AuthStack extends Stack {
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;
  public readonly userPoolDomain: UserPoolDomain;
  public readonly oauthDomain: string;

  constructor(scope: Construct, id: string, props?: AuthStackProps) {
    super(scope, id, props);

    const domainPrefix = process.env.COGNITO_DOMAIN_PREFIX || 'vela-local-auth';
    const googleClientId =
      process.env.GOOGLE_OAUTH_CLIENT_ID || 'local-synth-only.apps.googleusercontent.com';
    const googleClientSecretValue = process.env.GOOGLE_OAUTH_CLIENT_SECRET
      ? SecretValue.unsafePlainText(process.env.GOOGLE_OAUTH_CLIENT_SECRET)
      : SecretValue.secretsManager(
          process.env.GOOGLE_OAUTH_CLIENT_SECRET_NAME || 'vela/google-oauth-client-secret',
        );

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
        callbackUrls: [
          'http://localhost:9000/auth/callback',
          'http://127.0.0.1:9000/auth/callback',
          'https://vela.cwchanap.dev/auth/callback',
        ],
        logoutUrls: [
          'http://localhost:9000/auth/login',
          'http://127.0.0.1:9000/auth/login',
          'https://vela.cwchanap.dev/auth/login',
        ],
      },
    });
    userPoolClient.node.addDependency(googleProvider);

    this.userPool = userPool;
    this.userPoolClient = userPoolClient;
    this.userPoolDomain = userPoolDomain;
    this.oauthDomain = `${domainPrefix}.auth.${Stack.of(this).region}.amazoncognito.com`;
  }
}
