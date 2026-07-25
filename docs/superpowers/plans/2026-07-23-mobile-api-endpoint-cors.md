# HPA-204: Mobile API Endpoint + CORS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure the Capacitor iOS app to call the Vela API via an absolute URL and extend CORS to accept the native `capacitor://localhost` origin.

**Architecture:** The mobile app reads `VITE_MOBILE_API_URL` (distinct from the web's `VITE_API_URL` to avoid monorepo env leakage). The existing CORS middleware needs no code changes — `capacitor://localhost` is added to allowlists in CDK defaults, the API dev fallback, and `.env.example` templates. A build-time Vite plugin catches missing/malformed config before the app ships. inject-env.ts generates the mobile `.env.production` after CDK deploy.

**Tech Stack:** Quasar/Vue.js (mobile), Hono (API), AWS CDK (infra), Bun (test runner for API/CDK), Vitest (mobile unit tests)

**Spec:** `docs/superpowers/specs/2026-07-23-mobile-api-endpoint-cors-design.md`

## Global Constraints

- Mobile env var is `VITE_MOBILE_API_URL` (NOT `VITE_API_URL` — that's web-only)
- CORS middleware code (`apps/vela-api/src/middleware/cors.ts`) must NOT be modified
- Mobile unit test coverage gate: 95% lines (`apps/vela-mobile/vitest.config.ts`)
- `AGENTS.md` is a symlink to `CLAUDE.md` — edit `AGENTS.md`
- Capacitor 7 default iOS scheme is `capacitor://localhost`

---

### Task 1: Mobile config — api.url + validateConfig

**Files:**

- Modify: `apps/vela-mobile/src/config/index.ts`
- Modify: `apps/vela-mobile/src/env.d.ts`
- Create: `apps/vela-mobile/src/config/index.test.ts`

**Interfaces:**

- Produces: `config.api.url` (string — the absolute API URL), `validateConfig(env?: ConfigEnv): boolean`

- [ ] **Step 1: Write the failing tests**

Create `apps/vela-mobile/src/config/index.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, validateConfig } from './index';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('config', () => {
  it('exports a config object with api.url', () => {
    expect(config).toBeDefined();
    expect(typeof config.api.url).toBe('string');
  });

  it('reads VITE_MOBILE_API_URL', () => {
    expect(config.api.url).toBe(import.meta.env.VITE_MOBILE_API_URL || '');
  });
});

describe('validateConfig', () => {
  it('is a function', () => {
    expect(typeof validateConfig).toBe('function');
  });

  it('warns and returns true when import.meta.env is unavailable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validateConfig(null)).toBe(true);
    expect(warn).toHaveBeenCalledWith('Environment variables not available in this context');
  });

  it('throws in production when VITE_MOBILE_API_URL is missing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { PROD: true };
    expect(() => validateConfig(env)).toThrow(
      'Missing required environment variable: VITE_MOBILE_API_URL',
    );
    expect(error).toHaveBeenCalledWith(
      'Missing required environment variable: VITE_MOBILE_API_URL',
    );
  });

  it('throws in production when VITE_MOBILE_API_URL is blank', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { PROD: true, VITE_MOBILE_API_URL: '   ' };
    expect(() => validateConfig(env)).toThrow(
      'Missing required environment variable: VITE_MOBILE_API_URL',
    );
  });

  it('throws in production when VITE_MOBILE_API_URL is relative', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { PROD: true, VITE_MOBILE_API_URL: '/api/' };
    expect(() => validateConfig(env)).toThrow(/must be a valid absolute http\(s\) URL/);
  });

  it('throws in production for a malformed URL like "https://"', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { PROD: true, VITE_MOBILE_API_URL: 'https://' };
    expect(() => validateConfig(env)).toThrow(/must be a valid absolute http\(s\) URL/);
  });

  it('throws in production for a non-http protocol', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { PROD: true, VITE_MOBILE_API_URL: 'ftp://example.com/api/' };
    expect(() => validateConfig(env)).toThrow(/must be a valid absolute http\(s\) URL/);
  });

  it('passes in production with a valid absolute URL', () => {
    const env = { PROD: true, VITE_MOBILE_API_URL: 'https://vela.cwchanap.dev/api/' };
    expect(() => validateConfig(env)).not.toThrow();
    expect(validateConfig(env)).toBe(true);
  });

  it('warns but does not throw in dev when URL is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = { PROD: false };
    expect(validateConfig(env)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      'VITE_MOBILE_API_URL not set — API calls will fail until configured.',
    );
  });

  it('warns but does not throw in dev when URL is relative', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = { PROD: false, VITE_MOBILE_API_URL: '/api/' };
    expect(validateConfig(env)).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a valid absolute URL'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/vela-mobile && bun vitest run src/config/index.test.ts`
Expected: FAIL — `config.api` is undefined, `validateConfig` is not a function

- [ ] **Step 3: Add VITE_MOBILE_API_URL to env.d.ts**

In `apps/vela-mobile/src/env.d.ts`, add `VITE_MOBILE_API_URL` to the `ImportMetaEnv` interface (after the `VITE_APP_VERSION` line):

```ts
interface ImportMetaEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_VERSION: string;
  readonly VITE_MOBILE_API_URL: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly [key: string]: string | boolean | undefined;
}
```

- [ ] **Step 4: Implement config + validateConfig**

Replace the entire contents of `apps/vela-mobile/src/config/index.ts`:

```ts
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

  return true;
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/vela-mobile && bun vitest run src/config/index.test.ts`
Expected: PASS — all tests green

- [ ] **Step 6: Check coverage**

Run: `cd apps/vela-mobile && bun vitest run src/config/index.test.ts --coverage`
Expected: `src/config/index.ts` coverage ≥ 95% lines

- [ ] **Step 7: Commit**

```bash
git add apps/vela-mobile/src/config/index.ts apps/vela-mobile/src/config/index.test.ts apps/vela-mobile/src/env.d.ts
git commit -m "feat(mobile): add VITE_MOBILE_API_URL config + validateConfig

Add api.url (absolute URL for native builds) and validateConfig that
throws in production for missing/relative/malformed URLs and warns in
dev. Uses new URL() parsing — rejects https://, non-http protocols,
and missing hostnames."
```

---

### Task 2: Wire validateConfig into boot + .env.example

**Files:**

- Modify: `apps/vela-mobile/src/boot/main.ts`
- Modify: `apps/vela-mobile/src/boot/main.test.ts`
- Modify: `apps/vela-mobile/.env.example`

**Interfaces:**

- Consumes: `validateConfig` from Task 1

- [ ] **Step 1: Update the boot test**

Replace `apps/vela-mobile/src/boot/main.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import boot from './main';

describe('boot/main', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('exports a function', () => {
    expect(typeof boot).toBe('function');
  });

  it('logs in dev mode', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('DEV', true);
    (boot as (params: any) => void)({} as any);
    expect(log).toHaveBeenCalledWith('Vela Mobile boot initialized');
  });

  it('does not log the init message in production', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('DEV', false);
    (boot as (params: any) => void)({} as any);
    expect(log).not.toHaveBeenCalledWith('Vela Mobile boot initialized');
  });
});
```

- [ ] **Step 2: Run tests to verify they still pass (boot hasn't changed yet)**

Run: `cd apps/vela-mobile && bun vitest run src/boot/main.test.ts`
Expected: PASS (the test calls boot which doesn't yet call validateConfig — but the test structure is ready)

- [ ] **Step 3: Implement boot to call validateConfig**

Replace `apps/vela-mobile/src/boot/main.ts`:

```ts
import { defineBoot } from '#q-app/wrappers';
import { validateConfig } from 'src/config';

export default defineBoot(() => {
  validateConfig();

  if (import.meta.env.DEV) {
    console.log('Vela Mobile boot initialized');
  }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/vela-mobile && bun vitest run src/boot/main.test.ts`
Expected: PASS

- [ ] **Step 5: Update .env.example**

In `apps/vela-mobile/.env.example`, add the mobile API URL after the existing content:

```dotenv
# App Configuration
VITE_APP_NAME=Vela
VITE_APP_VERSION=0.0.1

# API base URL — must be absolute (native builds have no web origin).
# Dev:        http://localhost:9005/api/
# Prod:       https://vela.cwchanap.dev/api/  (generated into .env.production
#             by packages/cdk/scripts/inject-env.ts after cdk:deploy)
VITE_MOBILE_API_URL=http://localhost:9005/api/
```

- [ ] **Step 6: Run full mobile test suite to check for regressions**

Run: `cd apps/vela-mobile && bun vitest run`
Expected: PASS — all tests green, no regressions

- [ ] **Step 7: Commit**

```bash
git add apps/vela-mobile/src/boot/main.ts apps/vela-mobile/src/boot/main.test.ts apps/vela-mobile/.env.example
git commit -m "feat(mobile): wire validateConfig into boot + add .env.example

Call validateConfig() at boot (throws in prod on missing/malformed
VITE_MOBILE_API_URL, warns in dev). Add VITE_MOBILE_API_URL to
.env.example with dev/prod documentation."
```

---

### Task 3: Build-time validation plugin

**Files:**

- Modify: `apps/vela-mobile/quasar.config.ts`

**Interfaces:**

- Consumes: none (self-contained URL validation in the plugin)

- [ ] **Step 1: Add the build-time validation plugin to quasar.config.ts**

Replace `apps/vela-mobile/quasar.config.ts`. Add imports for `resolve`, `existsSync`, `readFileSync` at the top and an `extendViteConf` with a validation plugin:

```ts
import { defineConfig } from '#q-app/wrappers';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export default defineConfig(() => {
  return {
    boot: ['main'],

    css: ['app.scss'],

    extras: ['material-icons', 'roboto-font'],

    build: {
      target: {
        browser: ['es2022', 'safari14'],
        node: 'node20',
      },

      typescript: {
        strict: true,
        vueShim: true,
      },

      vueRouterMode: 'history',

      publicPath: '/',

      extendViteConf(viteConf) {
        viteConf.plugins = viteConf.plugins || [];
        viteConf.plugins.push({
          name: 'validate-mobile-api-url',
          config(_, { mode }) {
            if (mode !== 'production') return;

            const envPath = resolve(__dirname, '.env.production');
            if (!existsSync(envPath)) {
              throw new Error(
                'apps/vela-mobile/.env.production not found. ' +
                  'Run packages/cdk/scripts/inject-env.ts after cdk:deploy, ' +
                  'or create it manually with VITE_MOBILE_API_URL.',
              );
            }

            const content = readFileSync(envPath, 'utf8');
            const match = content.match(/^VITE_MOBILE_API_URL=(.+)$/m);
            const url = match?.[1]?.trim();

            if (!url) {
              throw new Error(
                'VITE_MOBILE_API_URL is missing from apps/vela-mobile/.env.production.',
              );
            }

            try {
              const parsed = new URL(url);
              if (
                (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
                !parsed.hostname
              ) {
                throw new Error('invalid');
              }
            } catch {
              throw new Error(
                `VITE_MOBILE_API_URL must be a valid absolute http(s) URL with a hostname, got: ${url}`,
              );
            }
          },
        });
      },
    },

    devServer: {
      open: false,
      port: 9100,
    },

    framework: {
      plugins: ['Notify', 'LocalStorage', 'Dark'],
    },

    capacitor: {
      hideSplashscreen: true,
    },

    animations: [],
  };
});
```

- [ ] **Step 2: Verify the build fails without .env.production**

Run: `cd apps/vela-mobile && rm -f .env.production && bun run build 2>&1 | head -5`
Expected: FAIL with "apps/vela-mobile/.env.production not found"

- [ ] **Step 3: Verify the build passes with a valid .env.production**

Run:

```bash
cd apps/vela-mobile && echo 'VITE_MOBILE_API_URL=https://vela.cwchanap.dev/api/' > .env.production && bun run build 2>&1 | tail -5 && rm -f .env.production
```

Expected: Build succeeds (no validation error)

- [ ] **Step 4: Run mobile test suite to verify no regressions**

Run: `cd apps/vela-mobile && bun vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/vela-mobile/quasar.config.ts
git commit -m "feat(mobile): add build-time VITE_MOBILE_API_URL validation

Vite plugin reads .env.production during production builds and throws
if VITE_MOBILE_API_URL is missing, relative, or malformed. Catches
clean-checkout builds before they ship to TestFlight."
```

---

### Task 4: CORS middleware — capacitor origin tests

**Files:**

- Modify: `apps/vela-api/test/middleware/cors.test.ts`

**Interfaces:**

- Consumes: existing `isAllowedOrigin`, `corsMiddleware` from `apps/vela-api/src/middleware/cors.ts`

- [ ] **Step 1: Write the failing tests**

Append to the end of `apps/vela-api/test/middleware/cors.test.ts` (after the last `describe` block):

```ts
describe('Capacitor mobile origins', () => {
  test('should return isAllowed=true, isWebOrigin=true for capacitor://localhost', () => {
    const env: Env = {
      CORS_ALLOWED_ORIGINS: 'https://vela.cwchanap.dev,capacitor://localhost',
    };
    const result = isAllowedOrigin('capacitor://localhost', env);

    expect(result.isAllowed).toBe(true);
    expect(result.isWebOrigin).toBe(true);
    expect(result.allowedOrigin).toBe('capacitor://localhost');
  });

  test('should reject capacitor://localhost when not in allowlist', () => {
    const env: Env = {
      CORS_ALLOWED_ORIGINS: 'https://vela.cwchanap.dev',
    };
    const result = isAllowedOrigin('capacitor://localhost', env);

    expect(result.isAllowed).toBe(false);
    expect(result.isWebOrigin).toBe(false);
  });

  test('should allow GET from capacitor://localhost with credentials', async () => {
    const app = createTestApp({
      CORS_ALLOWED_ORIGINS: 'capacitor://localhost',
    });
    const req = new Request('http://localhost/test', {
      method: 'GET',
      headers: { Origin: 'capacitor://localhost' },
    });
    const res = await app.request(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toBe('GET success');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  test('should reject GET from capacitor://localhost when not in allowlist', async () => {
    const app = createTestApp({
      CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
    });
    const req = new Request('http://localhost/test', {
      method: 'GET',
      headers: { Origin: 'capacitor://localhost' },
    });
    const res = await app.request(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain('CORS policy violation');
  });
});
```

- [ ] **Step 2: Run tests to verify they pass (middleware already handles capacitor origin)**

Run: `cd apps/vela-api && bun test test/middleware/cors.test.ts`
Expected: PASS — all tests green (the existing middleware does exact-string matching, so `capacitor://localhost` works when it's in `CORS_ALLOWED_ORIGINS`)

- [ ] **Step 3: Run full API test suite**

Run: `cd apps/vela-api && bun test`
Expected: PASS — no regressions

- [ ] **Step 4: Commit**

```bash
git add apps/vela-api/test/middleware/cors.test.ts
git commit -m "test(api): add capacitor://localhost CORS origin tests

Verify isAllowedOrigin and corsMiddleware handle the Capacitor iOS
origin correctly — allowed with credentials when in CORS_ALLOWED_ORIGINS,
rejected when not. No middleware code changes needed."
```

---

### Task 5: API dev CORS fallback + .env.example

**Files:**

- Modify: `apps/vela-api/src/index.ts`
- Modify: `apps/vela-api/.env.example`

- [ ] **Step 1: Update the dev fallback in buildEnv()**

In `apps/vela-api/src/index.ts`, find the `CORS_ALLOWED_ORIGINS` line inside `buildEnv()` (around line 47-49) and append the mobile dev + capacitor origins:

Old:

```ts
    CORS_ALLOWED_ORIGINS:
      process.env.CORS_ALLOWED_ORIGINS ||
      (isDev ? 'http://localhost:9000,http://127.0.0.1:9000' : undefined),
```

New:

```ts
    CORS_ALLOWED_ORIGINS:
      process.env.CORS_ALLOWED_ORIGINS ||
      (isDev
        ? 'http://localhost:9000,http://127.0.0.1:9000,http://localhost:9100,http://127.0.0.1:9100,capacitor://localhost'
        : undefined),
```

- [ ] **Step 2: Update apps/vela-api/.env.example**

In `apps/vela-api/.env.example`, update the `CORS_ALLOWED_ORIGINS` line (line 26):

Old:

```dotenv
# CORS Configuration
# Use a specific list of allowed origins instead of a wildcard for security.
# Update https://your-frontend-app.com to your actual production frontend URL.
CORS_ALLOWED_ORIGINS=https://your-frontend-app.com,http://localhost:9000,http://127.0.0.1:9000
```

New:

```dotenv
# CORS Configuration
# Use a specific list of allowed origins instead of a wildcard for security.
# Update https://your-frontend-app.com to your actual production frontend URL.
# capacitor://localhost is the Capacitor iOS WKWebView origin (production native builds).
# http://localhost:9100 is the mobile Quasar dev server.
CORS_ALLOWED_ORIGINS=https://your-frontend-app.com,http://localhost:9000,http://127.0.0.1:9000,http://localhost:9100,http://127.0.0.1:9100,capacitor://localhost
```

- [ ] **Step 3: Run API tests to verify no regressions**

Run: `cd apps/vela-api && bun test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/vela-api/src/index.ts apps/vela-api/.env.example
git commit -m "feat(api): add mobile dev + capacitor origins to CORS dev fallback

Add http://localhost:9100 (mobile dev server), 127.0.0.1:9100, and
capacitor://localhost (native iOS builds) to the buildEnv() dev
fallback and .env.example so native builds against local API work."
```

---

### Task 6: CDK ApiStack — capacitor defaults + allowCredentials

**Files:**

- Modify: `packages/cdk/lib/api-stack.ts`
- Modify: `packages/cdk/test/api-stack.test.ts`

**Interfaces:**

- Produces: CDK default origins now include `capacitor://localhost`; preflight includes `allowCredentials: true`

- [ ] **Step 1: Write the failing CDK tests**

In `packages/cdk/test/api-stack.test.ts`, add these tests inside the existing `describe('ApiStack', ...)` block (after the existing test):

```ts
test('includes capacitor://localhost in default CORS_ALLOWED_ORIGINS', () => {
  const template = synthesizeTemplate();

  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: {
      Variables: Match.objectLike({
        CORS_ALLOWED_ORIGINS: Match.stringLikeRegexp('capacitor://localhost'),
      }),
    },
  });

  template.hasResourceProperties('AWS::ApiGateway::Method', {
    HttpMethod: 'OPTIONS',
    Integration: Match.objectLike({
      IntegrationResponses: Match.arrayWith([
        Match.objectLike({
          ResponseTemplates: Match.objectLike({
            'application/json': Match.stringLikeRegexp('capacitor://localhost'),
          }),
        }),
      ]),
    }),
  });
});

test('passes capacitor://localhost through when CORS_ALLOWED_ORIGINS is overridden', () => {
  process.env.CORS_ALLOWED_ORIGINS = 'https://staging.example.com,capacitor://localhost';

  const template = synthesizeTemplate();

  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: {
      Variables: Match.objectLike({
        CORS_ALLOWED_ORIGINS: 'https://staging.example.com,capacitor://localhost',
      }),
    },
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cdk && CDK_SPA_DIST_PATH=/tmp/empty bun test test/api-stack.test.ts`
Expected: FAIL — `capacitor://localhost` not in default origins

- [ ] **Step 3: Add capacitor://localhost to CDK default origins**

In `packages/cdk/lib/api-stack.ts`, update the `defaultAllowedOrigins` constant (around line 33-34):

Old:

```ts
const defaultAllowedOrigins =
  'https://vela.cwchanap.dev,http://localhost:9000,http://127.0.0.1:9000';
```

New:

```ts
const defaultAllowedOrigins =
  'https://vela.cwchanap.dev,http://localhost:9000,http://127.0.0.1:9000,capacitor://localhost';
```

- [ ] **Step 4: Run the capacitor origin tests to verify they pass**

Run: `cd packages/cdk && CDK_SPA_DIST_PATH=/tmp/empty bun test test/api-stack.test.ts`
Expected: PASS

- [ ] **Step 5: Add allowCredentials to preflight config**

In `packages/cdk/lib/api-stack.ts`, update the `defaultCorsPreflightOptions` (around line 134-144). Add `allowCredentials: true`:

Old:

```ts
      defaultCorsPreflightOptions: {
        allowOrigins: [...allowedOriginsList, ...allowedExtensionOriginsList],
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },
```

New:

```ts
      defaultCorsPreflightOptions: {
        allowOrigins: [...allowedOriginsList, ...allowedExtensionOriginsList],
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: true,
      },
```

- [ ] **Step 6: Run all CDK tests to verify no regressions**

Run: `cd packages/cdk && CDK_SPA_DIST_PATH=/tmp/empty bun test`
Expected: PASS — all tests green

- [ ] **Step 7: Commit**

```bash
git add packages/cdk/lib/api-stack.ts packages/cdk/test/api-stack.test.ts
git commit -m "feat(cdk): add capacitor://localhost to CORS defaults + allowCredentials

Add the Capacitor iOS WKWebView origin to defaultAllowedOrigins so
production native builds are accepted. Add allowCredentials: true to
the API Gateway preflight to close the dev/prod divergence — the Hono
middleware already sets it on actual responses but API Gateway mock
OPTIONS never did."
```

---

### Task 7: inject-env.ts — generate mobile .env.production

**Files:**

- Modify: `packages/cdk/scripts/inject-env.ts`
- Modify: `packages/cdk/test/inject-env.test.ts`

**Interfaces:**

- Produces: `apps/vela-mobile/.env.production` with `VITE_MOBILE_API_URL=https://vela.cwchanap.dev/api/`

- [ ] **Step 1: Write the failing test**

In `packages/cdk/test/inject-env.test.ts`, add this test inside the existing `describe('inject-env', ...)` block (after the last test):

```ts
test('generates apps/vela-mobile/.env.production with absolute VITE_MOBILE_API_URL', () => {
  writeOutputs([
    { OutputKey: 'CognitoUserPoolId', OutputValue: 'us-east-1_testPool' },
    { OutputKey: 'CognitoUserPoolClientId', OutputValue: 'test-client-id' },
    { OutputKey: 'CognitoRegion', OutputValue: 'us-east-1' },
  ]);

  const result = runInjectEnv();

  expect(result.status).toBe(0);
  const mobileEnvPath = path.join(tempRoot, 'apps', 'vela-mobile', '.env.production');
  expect(fs.existsSync(mobileEnvPath)).toBe(true);
  const mobileEnv = fs.readFileSync(mobileEnvPath, 'utf8');
  expect(mobileEnv).toContain('VITE_MOBILE_API_URL=https://vela.cwchanap.dev/api/');
  expect(mobileEnv).not.toContain('VITE_MOBILE_API_URL=/api/');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cdk && bun test test/inject-env.test.ts`
Expected: FAIL — `apps/vela-mobile/.env.production` does not exist

- [ ] **Step 3: Extend inject-env.ts to generate the mobile .env.production**

In `packages/cdk/scripts/inject-env.ts`, after the web `.env.production` write block (after line 101, before the closing `}` of `main()`), add:

```ts
// Generate apps/vela-mobile/.env.production with the mobile API URL
const mobileApiUrl = 'https://vela.cwchanap.dev/api/';

// Validate the mobile API URL is absolute
try {
  const parsed = new URL(mobileApiUrl);
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    throw new Error('invalid');
  }
} catch {
  throw new Error(`Mobile API URL must be a valid absolute http(s) URL, got: ${mobileApiUrl}`);
}

const mobileEnvFilePath = path.join(repoRoot, 'apps', 'vela-mobile', '.env.production');
const mobileEnvDir = path.dirname(mobileEnvFilePath);
fs.mkdirSync(mobileEnvDir, { recursive: true });

const mobileLines = [`VITE_MOBILE_API_URL=${mobileApiUrl}`];
const mobileContent = `${mobileLines.join('\n')}\n`;

try {
  fs.writeFileSync(mobileEnvFilePath, mobileContent, 'utf8');
  console.log(`Wrote environment variables to ${mobileEnvFilePath}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Failed to write environment variables to ${mobileEnvFilePath}: ${message}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cdk && bun test test/inject-env.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Run full CDK test suite**

Run: `cd packages/cdk && CDK_SPA_DIST_PATH=/tmp/empty bun test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cdk/scripts/inject-env.ts packages/cdk/test/inject-env.test.ts
git commit -m "feat(cdk): generate mobile .env.production with VITE_MOBILE_API_URL

inject-env.ts now writes apps/vela-mobile/.env.production with the
absolute production API URL alongside the existing web .env.production.
Uses VITE_MOBILE_API_URL (not VITE_API_URL) to avoid the monorepo
env-var collision documented in the spec."
```

---

### Task 8: turbo.json + root .env.example + AGENTS.md

**Files:**

- Modify: `turbo.json`
- Modify: `.env.example`
- Modify: `AGENTS.md`

- [ ] **Step 1: Add VITE_MOBILE_API_URL to turbo.json build.env**

In `turbo.json`, add `"VITE_MOBILE_API_URL"` to the `build.env` array (after `"VITE_API_URL"`):

```json
      "env": [
        "VITE_APP_NAME",
        "VITE_APP_VERSION",
        "VITE_DEV_MODE",
        "VITE_API_URL",
        "VITE_MOBILE_API_URL",
        "VITE_AWS_REGION",
        "VITE_COGNITO_USER_POOL_ID",
        "VITE_COGNITO_USER_POOL_CLIENT_ID",
        "VITE_COGNITO_OAUTH_DOMAIN",
        "VITE_COGNITO_REDIRECT_SIGN_IN",
        "VITE_COGNITO_REDIRECT_SIGN_OUT"
      ],
```

- [ ] **Step 2: Fix root .env.example — stale port + CORS origins**

In `.env.example` (root), update the API URL and CORS sections:

Old:

```dotenv
# API Base URL (frontend -> backend proxy). Defaults to '/api/' if not set.
VITE_API_URL=http://localhost:3001/api/
# API CORS allowlists. Extension IDs are the bare IDs without chrome-extension://.
CORS_ALLOWED_ORIGINS=http://localhost:9000,http://127.0.0.1:9000
CORS_ALLOWED_EXTENSION_IDS=your_chrome_extension_id_here,your_firefox_extension_id_here
```

New:

```dotenv
# API Base URL (web app -> backend proxy via CloudFront /api/*). Defaults to '/api/' if not set.
# The mobile app uses VITE_MOBILE_API_URL (absolute) instead — see apps/vela-mobile/.env.example.
VITE_API_URL=http://localhost:9005/api/
# API CORS allowlists. Extension IDs are the bare IDs without chrome-extension://.
# capacitor://localhost is the Capacitor iOS WKWebView origin (production native builds).
# http://localhost:9100 is the mobile Quasar dev server.
CORS_ALLOWED_ORIGINS=http://localhost:9000,http://127.0.0.1:9000,http://localhost:9100,http://127.0.0.1:9100,capacitor://localhost
CORS_ALLOWED_EXTENSION_IDS=your_chrome_extension_id_here,your_firefox_extension_id_here
```

- [ ] **Step 3: Update AGENTS.md M2 work item #3**

In `AGENTS.md` (symlink → `CLAUDE.md`), find the M2 work item #3 under the Mobile section:

Old:

```text
3. If API calls go through WKWebView, add `capacitor://localhost` to the API CORS allow-list.
```

New:

```text
3. ~~If API calls go through WKWebView, add `capacitor://localhost` to the API CORS allow-list.~~ **Done in M1 (HPA-204).** The CORS allowlist is not a security boundary for native clients — `capacitor://localhost` is shared across all Capacitor apps and the middleware passes requests with no `Origin` header. JWT verification (item #1 above) is the actual auth boundary.
```

- [ ] **Step 4: Verify all tests still pass across affected packages**

Run:

```bash
cd apps/vela-mobile && bun vitest run && cd ../../apps/vela-api && bun test && cd ../../packages/cdk && CDK_SPA_DIST_PATH=/tmp/empty bun test
```

Expected: PASS — all suites green

- [ ] **Step 5: Commit**

```bash
git add turbo.json .env.example AGENTS.md
git commit -m "chore: add VITE_MOBILE_API_URL to turbo, fix root .env.example, update AGENTS.md

- turbo.json: add VITE_MOBILE_API_URL to build.env for cache fingerprinting
- Root .env.example: fix stale port 3001→9005, add mobile dev + capacitor
  CORS origins, clarify VITE_API_URL is web-only
- AGENTS.md: mark M2 CORS item as done in M1 (HPA-204), note CORS is
  not a native auth boundary"
```
