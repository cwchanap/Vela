/// <reference types="vite/client" />

declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: string;
  }
}

interface ImportMetaEnv {
  readonly VITE_COGNITO_USER_POOL_ID: string;
  readonly VITE_COGNITO_USER_POOL_CLIENT_ID: string;
  readonly VITE_COGNITO_OAUTH_DOMAIN: string;
  readonly VITE_COGNITO_REDIRECT_SIGN_IN?: string;
  readonly VITE_COGNITO_REDIRECT_SIGN_OUT?: string;
  readonly VITE_AWS_REGION: string;
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_VERSION: string | number;
  readonly VITE_API_URL: string;
  readonly VITE_DEV_MODE?: boolean | string;
  readonly QUASAR_VUE_ROUTER_BASE: string;
  readonly QUASAR_VUE_ROUTER_MODE: 'history' | 'hash';
  readonly QUASAR_SERVER?: boolean;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly [key: string]: string | number | boolean | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
