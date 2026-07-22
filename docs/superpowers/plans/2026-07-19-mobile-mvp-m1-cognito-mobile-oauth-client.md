# Mobile MVP M1: Cognito Mobile OAuth Client + iOS Deep-Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision a third Cognito app client (`vela-mobile-client`) configured for public PKCE OAuth, register an iOS custom URL scheme to receive the callback, and expose the new client ID through CloudFormation outputs — without changing the existing web or test client contracts.

**Architecture:** Inline a third `UserPoolClient` in `packages/cdk/lib/auth-stack.ts` next to the existing web and test clients, with synth-time scheme validation that throws if the mobile callback/logout URIs do not use the registered iOS scheme (`dev.cwchanap.vela.oauth`). Surface the new client ID via a `CognitoMobileUserPoolClientId` output on `StaticWebStack`. Register the scheme in `apps/vela-mobile/src-capacitor/ios/App/App/Info.plist` via `CFBundleURLTypes` (no Swift changes — `AppDelegate` already forwards to `ApplicationDelegateProxy.shared`). Document the result in `CLAUDE.md` and `.env.example`.

**Tech Stack:** AWS CDK v2 (`aws-cdk-lib/aws-cognito`), Bun test runner (CDK tests), Vitest (mobile app tests), Vue/Quasar iOS app via Capacitor, Cognito user pool with Google IdP.

**Spec:** `docs/superpowers/specs/2026-07-19-mobile-mvp-m1-cognito-mobile-oauth-client-design.md`

## Global Constraints

- Custom OAuth scheme is **`dev.cwchanap.vela.oauth`** (reverse-DNS of the controlled `vela.cwchanap.dev` domain; do NOT use `com.vela.app` — that's the bundle id, separate namespace).
- Bundle id stays `com.vela.app`; only the OAuth scheme changes.
- Callback URI: `dev.cwchanap.vela.oauth://oauth/callback`. Logout URI: `dev.cwchanap.vela.oauth://oauth/logout`.
- The mobile client MUST be public: `generateSecret: false` (explicit, not implicit default).
- Web and test client behaviour must remain unchanged. Existing tests that count clients or use unpinned `hasResourceProperties` must be updated to pin `ClientName: 'vela-web-client'` where they were implicitly asserting the web client's contract.
- Mobile callback/logout URI overrides via `COGNITO_MOBILE_CALLBACK_URLS` / `COGNITO_MOBILE_LOGOUT_URLS` MUST be validated to use the registered scheme; a typo like `dev.cwchanap.vela.dev://...` must throw at synth time, not deploy silently.
- Documentation target is **`CLAUDE.md`** at the repo root (`AGENTS.md` is a symlink to it).
- M2 prerequisites (API JWT verifier widening, mobile client ID injection, Capacitor OAuth integration, `state`/`nonce`) are **out of scope** — the spec documents them, this plan does not implement them.

---

## File Structure

**Files created:**

- `packages/cdk/test/static-web-stack.test.ts` — new test file for the `StaticWebStack` outputs (none exists today).
- `apps/vela-mobile/src/ios/info-plist.test.ts` — plist scheme-registration test. **Must live under `src/`** because `vitest.config.ts:19` only includes `src/**` and `scripts/**`.

**Files modified:**

- `packages/cdk/lib/auth-stack.ts` — add constants, validation helper, and the `mobileUserPoolClient` block.
- `packages/cdk/lib/static-web-stack.ts` — add the `CognitoMobileUserPoolClientId` `CfnOutput`.
- `packages/cdk/test/auth-stack.test.ts` — add mobile-client tests, scheme-rejection test, class-field test; update the two literal-count assertions and pin the three nameless `hasResourceProperties` tests to `ClientName: 'vela-web-client'`.
- `apps/vela-mobile/src-capacitor/ios/App/App/Info.plist` — add `CFBundleURLTypes` block registering `dev.cwchanap.vela.oauth`.
- `CLAUDE.md` — extend the Authentication section with a "Mobile client (iOS)" subsection.
- `.env.example` — append `COGNITO_MOBILE_CALLBACK_URLS` / `COGNITO_MOBILE_LOGOUT_URLS` after the existing `CORS_ALLOWED_*` lines, under a `# CDK deploy-time only` comment block.

**Helper refactor inside the test file** (no new files): extend `synthesizeTemplate()` to expose the underlying `AuthStack`, or add a sibling `synthesizeStack()` helper, so the class-field test does not duplicate synthesis setup.

---

## Task 1: Add the `vela-mobile-client` to AuthStack (TDD)

**Files:**

- Modify: `packages/cdk/lib/auth-stack.ts`
- Modify: `packages/cdk/test/auth-stack.test.ts`

**Interfaces:**

- Produces: `AuthStack.mobileUserPoolClient: UserPoolClient` (new public readonly field). Consumed by `StaticWebStack` in Task 3.
- Produces: synth-time `Error` from `assertMobileScheme()` when `COGNITO_MOBILE_CALLBACK_URLS` / `COGNITO_MOBILE_LOGOUT_URLS` contains a URI that does not start with `dev.cwchanap.vela.oauth://`.

- [ ] **Step 1: Refactor the test helper to expose the stack instance**

Edit `packages/cdk/test/auth-stack.test.ts`. Replace the existing `synthesizeTemplate` function (lines 21–31) with two helpers — one returning just the `Template` (preserves call sites), one returning both the stack and template:

```ts
function synthesizeStack() {
  const app = new App();
  const stack = new AuthStack(app, 'TestAuthStack', {
    env: {
      account: '123456789012',
      region: 'us-east-1',
    },
  });
  return { stack, template: Template.fromStack(stack) };
}

function synthesizeTemplate(): Template {
  return synthesizeStack().template;
}
```

- [ ] **Step 2: Run the existing test suite to confirm the refactor is a no-op**

Run: `bun test` from `packages/cdk/`
Expected: all 12 existing tests still pass.

- [ ] **Step 3: Add the new mobile-client test block (will fail — no mobile client exists yet)**

Append the following inside the `describe('AuthStack', () => { … })` block, after the existing `'includes localhost OAuth URLs in deployed (non-placeholder) mode'` test:

```ts
test('mobile client uses the iOS custom-scheme callback and logout URIs', () => {
  const template = synthesizeTemplate();

  template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
    ClientName: 'vela-mobile-client',
    CallbackURLs: ['dev.cwchanap.vela.oauth://oauth/callback'],
    LogoutURLs: ['dev.cwchanap.vela.oauth://oauth/logout'],
  });
});

test('creates a dedicated public mobile client with PKCE-compatible OAuth', () => {
  const template = synthesizeTemplate();
  const clients = template.findResources('AWS::Cognito::UserPoolClient');
  const mobile = Object.values(clients).find(
    (c) => c.Properties.ClientName === 'vela-mobile-client',
  );

  expect(mobile).toBeDefined();
  // Public client — CloudFormation omits GenerateSecret when false; undefined is falsy.
  expect(mobile!.Properties.GenerateSecret).toBeFalsy();
  expect(mobile!.Properties.AllowedOAuthFlows).toEqual(['code']);
  expect(mobile!.Properties.AllowedOAuthFlowsUserPoolClient).toBe(true);
  expect(mobile!.Properties.SupportedIdentityProviders).toEqual(['Google']);
  expect(mobile!.Properties.AllowedOAuthScopes.toSorted()).toEqual(['email', 'openid', 'profile']);
  expect(mobile!.Properties.ExplicitAuthFlows).toEqual(['ALLOW_REFRESH_TOKEN_AUTH']);
});

test('mobile callback/logout URIs are overridable via env vars (same-scheme only)', () => {
  process.env.COGNITO_MOBILE_CALLBACK_URLS =
    'dev.cwchanap.vela.oauth://oauth/staging-callback,dev.cwchanap.vela.oauth://oauth/callback';
  process.env.COGNITO_MOBILE_LOGOUT_URLS = 'dev.cwchanap.vela.oauth://oauth/staging-logout';

  const template = synthesizeTemplate();
  const clients = template.findResources('AWS::Cognito::UserPoolClient');
  const byName = (name: string) =>
    Object.values(clients).find((c) => c.Properties.ClientName === name);

  const mobile = byName('vela-mobile-client');
  expect(mobile!.Properties.CallbackURLs).toEqual([
    'dev.cwchanap.vela.oauth://oauth/staging-callback',
    'dev.cwchanap.vela.oauth://oauth/callback',
  ]);
  expect(mobile!.Properties.LogoutURLs).toEqual(['dev.cwchanap.vela.oauth://oauth/staging-logout']);

  const web = byName('vela-web-client');
  expect(web!.Properties.CallbackURLs).toEqual(
    expect.arrayContaining([
      'https://vela.cwchanap.dev/auth/callback',
      'http://localhost:9000/auth/callback',
    ]),
  );
  expect(web!.Properties.LogoutURLs).toEqual(
    expect.arrayContaining([
      'https://vela.cwchanap.dev/auth/login',
      'http://localhost:9000/auth/login',
    ]),
  );
});

test('mobile callback/logout URIs fall back to defaults when env vars are empty', () => {
  process.env.COGNITO_MOBILE_CALLBACK_URLS = '';
  process.env.COGNITO_MOBILE_LOGOUT_URLS = '   ';

  const template = synthesizeTemplate();

  template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
    ClientName: 'vela-mobile-client',
    CallbackURLs: ['dev.cwchanap.vela.oauth://oauth/callback'],
    LogoutURLs: ['dev.cwchanap.vela.oauth://oauth/logout'],
  });
});

test('rejects mobile callback/logout URIs that do not use the registered scheme', () => {
  process.env.COGNITO_MOBILE_CALLBACK_URLS = 'dev.cwchanap.vela.dev://oauth/callback';

  expect(() => synthesizeTemplate()).toThrow(
    /COGNITO_MOBILE_CALLBACK_URLS must use the dev\.cwchanap\.vela\.oauth:\/\/ scheme/,
  );

  process.env.COGNITO_MOBILE_CALLBACK_URLS = '';
  process.env.COGNITO_MOBILE_LOGOUT_URLS = 'dev.cwchanap.vela.dev://oauth/logout';

  expect(() => synthesizeTemplate()).toThrow(
    /COGNITO_MOBILE_LOGOUT_URLS must use the dev\.cwchanap\.vela\.oauth:\/\/ scheme/,
  );
});

test('mobile client is distinct from web and test clients', () => {
  const template = synthesizeTemplate();
  const clients = Object.values(template.findResources('AWS::Cognito::UserPoolClient'));

  const byName = (name: string) => clients.find((c) => c.Properties.ClientName === name);

  expect(byName('vela-web-client')).toBeDefined();
  expect(byName('vela-test-client')).toBeDefined();
  expect(byName('vela-mobile-client')).toBeDefined();

  const names = clients.map((c) => c.Properties.ClientName);
  expect(new Set(names).size).toBe(3);
});

test('web client contract is unchanged by the mobile client addition', () => {
  const template = synthesizeTemplate();
  const clients = template.findResources('AWS::Cognito::UserPoolClient');
  const web = Object.values(clients).find((c) => c.Properties.ClientName === 'vela-web-client');

  expect(web!.Properties.SupportedIdentityProviders).toEqual(['Google']);
  expect(web!.Properties.AllowedOAuthFlows).toEqual(['code']);
  expect(web!.Properties.AllowedOAuthFlowsUserPoolClient).toBe(true);
  expect(web!.Properties.AllowedOAuthScopes.toSorted()).toEqual(['email', 'openid', 'profile']);
  expect(web!.Properties.ExplicitAuthFlows).toEqual(['ALLOW_REFRESH_TOKEN_AUTH']);
  expect(web!.Properties.GenerateSecret).toBeFalsy();
  expect(web!.Properties.CallbackURLs).toEqual(
    expect.arrayContaining([
      'https://vela.cwchanap.dev/auth/callback',
      'http://localhost:9000/auth/callback',
      'http://127.0.0.1:9000/auth/callback',
    ]),
  );
  expect(web!.Properties.LogoutURLs).toEqual(
    expect.arrayContaining([
      'https://vela.cwchanap.dev/auth/login',
      'http://localhost:9000/auth/login',
      'http://127.0.0.1:9000/auth/login',
    ]),
  );
});

test('exposes the mobile client as a public field on AuthStack', () => {
  const { stack } = synthesizeStack();

  expect(stack.mobileUserPoolClient).toBeDefined();
  expect(stack.mobileUserPoolClient.userPoolClientId).toBeDefined();
});
```

- [ ] **Step 4: Run the new tests — confirm they fail for the right reason**

Run: `bun test` from `packages/cdk/`
Expected: 8 new tests FAIL. The mobile-client tests fail because `vela-mobile-client` does not exist in the synthesised template; the class-field test fails because `stack.mobileUserPoolClient` is `undefined`. The scheme-rejection test fails because no validation throws.

- [ ] **Step 5: Add the new constants and `assertMobileScheme` helper to `auth-stack.ts`**

In `packages/cdk/lib/auth-stack.ts`, immediately after the existing `LOCAL_LOGOUT_URLS` declaration (around line 28), insert:

```ts
const MOBILE_OAUTH_SCHEME = 'dev.cwchanap.vela.oauth';
const DEFAULT_MOBILE_CALLBACK_URLS = [`${MOBILE_OAUTH_SCHEME}://oauth/callback`];
const DEFAULT_MOBILE_LOGOUT_URLS = [`${MOBILE_OAUTH_SCHEME}://oauth/logout`];

/**
 * Reject mobile callback/logout URIs that do not use the registered iOS scheme
 * or that use the right scheme with an empty/invalid path. `parseCommaList` is
 * permissive on its own; without this guard a typo like
 * `dev.cwchanap.vela.dev://...` (wrong scheme) or
 * `dev.cwchanap.vela.oauth://` (empty path) would synthesise + deploy
 * successfully and then fail silently on-device because iOS would have no
 * handler registered for the dispatch.
 *
 * Two distinct error branches so the failure message names the actual defect:
 *   1. Wrong scheme  → `${label} must use the ...:// scheme (...)`
 *   2. Right scheme, bad path (empty / whitespace-only / query-only /
 *      fragment-only) → `${label} must include a non-empty, non-whitespace
 *      path after ...:// (...)`
 *
 * The path check uses `^\.\.\.://[^\s?#]+\S*$` rather than a naive
 * `startsWith(prefix)` so it also rejects `scheme://` (no path), `scheme:// `
 * (whitespace-only path), `scheme://?query` (query-only, no path), and
 * `scheme://#fragment` (fragment-only, no path) — all of which Cognito would
 * accept but iOS would dispatch to a no-op handler.
 */
function assertMobileScheme(label: string, uris: string[]): void {
  const schemePrefix = `${MOBILE_OAUTH_SCHEME}://`;
  const mobileUriPattern = new RegExp(
    `^${MOBILE_OAUTH_SCHEME.replace(/\./g, '\\.')}://[^\\s?#]+\\S*$`,
  );
  for (const uri of uris) {
    if (!uri.startsWith(schemePrefix)) {
      throw new Error(
        `${label} must use the ${MOBILE_OAUTH_SCHEME}:// scheme (Info.plist only registers that scheme). Got: ${uri}`,
      );
    }
    if (!mobileUriPattern.test(uri)) {
      throw new Error(
        `${label} must include a non-empty, non-whitespace path after ${MOBILE_OAUTH_SCHEME}:// (query-only and fragment-only URIs have no path and dispatch to a no-op handler on-device). Got: ${uri}`,
      );
    }
  }
}
```

- [ ] **Step 6: Add the `mobileUserPoolClient` public field to the `AuthStack` class**

In the same file, in the `public readonly` field block near line 42–46, add:

```ts
public readonly mobileUserPoolClient: UserPoolClient;
```

(Place it between `testUserPoolClient` and `userPoolDomain`, or in alphabetical/grouped order — match the existing style.)

- [ ] **Step 7: Add the mobile client block — immediately after the existing `userPoolClient.node.addDependency(googleProvider);` line (around line 167)**

```ts
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
    callbackUrls: mobileCallbackUrls,
    logoutUrls: mobileLogoutUrls,
  },
});
mobileUserPoolClient.node.addDependency(googleProvider);
```

- [ ] **Step 8: Assign the new public field — alongside the other `this.foo = foo` lines (around line 188–192)**

```ts
this.mobileUserPoolClient = mobileUserPoolClient;
```

- [ ] **Step 9: Run the new tests — confirm they now pass**

Run: `bun test` from `packages/cdk/`
Expected: the 8 new tests PASS. Some older tests may now FAIL because they assert `allClients.length === 2` — that's expected, fix them in Step 10.

- [ ] **Step 10: Update existing count-based and nameless assertions to account for the third client**

In `packages/cdk/test/auth-stack.test.ts`:

**10a.** In the test `'creates a separate test client with admin auth flow enabled'` (around line 127), change:

```ts
expect(allClients.length).toBe(2);
```

to:

```ts
expect(allClients.length).toBe(3);
```

**10b.** In the test `'test client is distinct from the production web client'` (around line 143), make the same change — `toBe(2)` → `toBe(3)`.

**10c.** Pin the three nameless `hasResourceProperties` calls to `ClientName: 'vela-web-client'` so they cannot multi-match against the mobile client. The affected tests are:

- `'configures the user pool app client for Google-only OAuth code flow'` (around line 72): add `ClientName: 'vela-web-client',` as the first key in the `hasResourceProperties` argument object.
- `'uses custom callback and logout URLs from env vars'` (around line 194): same — add `ClientName: 'vela-web-client',`.
- `'falls back to default callback and logout URLs when env vars are empty'` (around line 211): same — add `ClientName: 'vela-web-client',`.

For `'includes localhost OAuth URLs in deployed (non-placeholder) mode'` (around line 231): it already includes `ClientName: 'vela-web-client'` — no change needed.

- [ ] **Step 11: Run the full CDK test suite — confirm everything passes**

Run: `bun test` from `packages/cdk/`
Expected: all tests PASS (existing 12 + new 8 = 20 total).

- [ ] **Step 12: Verify CDK synth succeeds end-to-end**

Run: `cdk:synth` from `packages/cdk/`
Expected: synthesis completes with no errors. Search the synthesised template for `vela-mobile-client` and confirm the new client appears with the expected properties.

- [ ] **Step 13: Commit**

```bash
git add packages/cdk/lib/auth-stack.ts packages/cdk/test/auth-stack.test.ts
git commit -m "feat(cdk): add vela-mobile-client for iOS OAuth (HPA-203)

- Add public mobile UserPoolClient with auth-code grant, Google IdP,
  no client secret (generateSecret: false explicit).
- Add synth-time scheme validation: throws if COGNITO_MOBILE_CALLBACK_URLS
  or COGNITO_MOBILE_LOGOUT_URLS contains a URI that does not use the
  registered dev.cwchanap.vela.oauth:// scheme.
- Pin three existing nameless hasResourceProperties tests to
  ClientName: 'vela-web-client' to avoid multi-match ambiguity.
- Update two literal-count assertions (2 -> 3 clients)."
```

---

## Task 2: Expose `CognitoMobileUserPoolClientId` in StaticWebStack

**Files:**

- Modify: `packages/cdk/lib/static-web-stack.ts`
- Create: `packages/cdk/test/static-web-stack.test.ts`

**Interfaces:**

- Consumes: `auth.mobileUserPoolClient.userPoolClientId` from Task 1.
- Produces: a CloudFormation output named `CognitoMobileUserPoolClientId` whose `Value` is an `Fn::ImportValue` of the AuthStack export backed by the mobile client, not the web or test client.

- [ ] **Step 1: Write the failing test**

Create `packages/cdk/test/static-web-stack.test.ts`:

```ts
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AuthStack } from '../lib/auth-stack';
import { DatabaseStack } from '../lib/database-stack';
import { StorageStack } from '../lib/storage-stack';
import { ApiStack } from '../lib/api-stack';
import { StaticWebStack } from '../lib/static-web-stack';

describe('StaticWebStack', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ALLOW_LOCAL_OAUTH_PLACEHOLDERS = 'true';
    process.env.COGNITO_DOMAIN_PREFIX = 'vela-test-auth';
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET_NAME = 'vela/test-google-oauth-client-secret';
    delete process.env.CLOUDFRONT_CERT_ARN;
    delete process.env.ACM_CERT_ARN;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function synthesize() {
    const app = new App();
    const stackEnv = { account: '123456789012', region: 'us-east-1' };
    const auth = new AuthStack(app, 'TestStaticAuthStack', { env: stackEnv });
    const database = new DatabaseStack(app, 'TestStaticDatabaseStack', { env: stackEnv });
    const storage = new StorageStack(app, 'TestStaticStorageStack', { env: stackEnv });
    const api = new ApiStack(app, 'TestStaticApiStack', {
      env: stackEnv,
      auth,
      database,
      storage,
    });
    const staticWeb = new StaticWebStack(app, 'TestStaticWebStack', {
      env: stackEnv,
      auth,
      database,
      storage,
      api,
    });
    return {
      stack: staticWeb,
      template: Template.fromStack(staticWeb),
      authTemplate: Template.fromStack(auth),
    };
  }

  test('exposes CognitoMobileUserPoolClientId wired to the mobile client resource', () => {
    const { template, authTemplate } = synthesize();

    // The output exists.
    const outputs = (template.toJSON().Outputs ?? {}) as Record<
      string,
      { Value: unknown; Description?: string }
    >;
    expect(outputs.CognitoMobileUserPoolClientId).toBeDefined();

    // AuthStack and StaticWebStack are separate stacks, so CDK renders the
    // cross-stack reference as an Fn::ImportValue rather than Fn::GetAtt.
    const value = outputs.CognitoMobileUserPoolClientId.Value as Record<string, unknown>;
    expect(value).toHaveProperty('Fn::ImportValue');
    const importValue = value['Fn::ImportValue'] as string;
    expect(importValue).toContain('VelaMobileUserPoolClient');
    expect(importValue).not.toContain('VelaTestUserPoolClient');

    // Confirm the imported export name embeds the logical id of the one
    // AuthStack client whose ClientName is vela-mobile-client.
    const clients = authTemplate.findResources('AWS::Cognito::UserPoolClient');
    const mobileLogicalIds = Object.keys(clients).filter(
      (id) => clients[id].Properties?.ClientName === 'vela-mobile-client',
    );
    expect(mobileLogicalIds).toHaveLength(1);
    expect(importValue).toContain(mobileLogicalIds[0]);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

Run: `bun test` from `packages/cdk/`
Expected: the new test FAILS — `outputs.CognitoMobileUserPoolClientId` is `undefined`.

- [ ] **Step 3: Add the `CognitoMobileUserPoolClientId` output to `StaticWebStack`**

In `packages/cdk/lib/static-web-stack.ts`, immediately after the existing `CognitoTestUserPoolClientId` output (around lines 192–195), insert:

```ts
new CfnOutput(this, 'CognitoMobileUserPoolClientId', {
  value: auth.mobileUserPoolClient.userPoolClientId,
  description: 'Cognito User Pool Client ID for the iOS mobile app (public, PKCE)',
});
```

- [ ] **Step 4: Run the test — confirm it passes**

Run: `bun test` from `packages/cdk/`
Expected: the new test PASSES.

- [ ] **Step 5: Verify CDK synth succeeds and emits the new output**

Run: `cdk:synth` from `packages/cdk/`
Expected: synthesis completes. The `StaticWebStack` template's `Outputs` block contains a `CognitoMobileUserPoolClientId` entry whose `Value` is an `Fn::ImportValue` of the AuthStack export for `VelaMobileUserPoolClient`.

- [ ] **Step 6: Commit**

```bash
git add packages/cdk/lib/static-web-stack.ts packages/cdk/test/static-web-stack.test.ts
git commit -m "feat(cdk): expose CognitoMobileUserPoolClientId output (HPA-203)

Adds a CloudFormation output for the mobile client ID on StaticWebStack.
Value is wired to auth.mobileUserPoolClient.userPoolClientId — asserted to
reference VelaMobileUserPoolClient, not the web or test client."
```

---

## Task 3: Register `dev.cwchanap.vela.oauth` custom URL scheme in iOS `Info.plist`

**Files:**

- Modify: `apps/vela-mobile/src-capacitor/ios/App/App/Info.plist`
- Create: `apps/vela-mobile/src/ios/info-plist.test.ts`

**Interfaces:**

- Produces: an iOS custom URL scheme declaration. iOS will hand URLs of the form `dev.cwchanap.vela.oauth://…` to the app via `AppDelegate.application(_:open:options:)` (already wired to `ApplicationDelegateProxy.shared`). No Swift changes.

- [ ] **Step 1: Write the failing plist scheme-registration test**

Create `apps/vela-mobile/src/ios/info-plist.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// Parse the plist as XML without adding a runtime dependency.
// The Info.plist is small and stable; a regex on the raw text is enough
// to catch "a Capacitor sync wiped the CFBundleURLTypes entry".
const plistPath = resolve(__dirname, '../../src-capacitor/ios/App/App/Info.plist');
const plistContent = readFileSync(plistPath, 'utf8');

function extractSchemes(xml: string): string[] {
  const schemes: string[] = [];
  const blockMatch = xml.match(/<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/);
  if (!blockMatch) return schemes;
  const stringRegex = /<string>([^<]+)<\/string>/g;
  let match: RegExpExecArray | null;
  while ((match = stringRegex.exec(blockMatch[1])) !== null) {
    schemes.push(match[1]);
  }
  return schemes;
}

describe('iOS Info.plist', () => {
  test('registers the dev.cwchanap.vela.oauth custom URL scheme', () => {
    const schemes = extractSchemes(plistContent);
    expect(schemes).toContain('dev.cwchanap.vela.oauth');
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

Run: `bun test` from `apps/vela-mobile/` (or `bun run test:unit` if the script differs)
Expected: the test FAILS — the plist has no `CFBundleURLSchemes` block today, so `extractSchemes` returns `[]`.

- [ ] **Step 3: Add the `CFBundleURLTypes` block to `Info.plist`**

In `apps/vela-mobile/src-capacitor/ios/App/App/Info.plist`, insert the following as a new top-level `<key>`/`<array>` pair inside the root `<dict>` (anywhere among the existing keys; convention is alphabetical or grouped with related launch-config keys). Place it immediately before the closing `</dict>`:

```xml
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>dev.cwchanap.vela.oauth</string>
        </array>
        <key>CFBundleURLName</key>
        <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
        <key>CFBundleTypeRole</key>
        <string>Editor</string>
    </dict>
</array>
```

- [ ] **Step 4: Run the test — confirm it passes**

Run: `bun test` from `apps/vela-mobile/`
Expected: the test PASSES.

- [ ] **Step 5: Verify the plist is still well-formed XML**

Run: `plutil -lint apps/vela-mobile/src-capacitor/ios/App/App/Info.plist`
Expected: `apps/vela-mobile/src-capacitor/ios/App/App/Info.plist: OK`

- [ ] **Step 6: Commit**

```bash
git add apps/vela-mobile/src-capacitor/ios/App/App/Info.plist apps/vela-mobile/src/ios/info-plist.test.ts
git commit -m "feat(mobile): register dev.cwchanap.vela.oauth URL scheme (HPA-203)

Adds CFBundleURLTypes to Info.plist so iOS hands OAuth callback URLs of
the form dev.cwchanap.vela.oauth://... to the Vela app. AppDelegate
already forwards opens through ApplicationDelegateProxy.shared, so no
Swift changes are needed. The scheme is rooted at cwchanap.dev (a
project-controlled domain) rather than the bundle id (com.vela.app)
because vela.app is not a controlled namespace.

Test placed under src/ so vitest.config.ts:19's include rule discovers
it (src-capacitor/ is not in the include list)."
```

---

## Task 4: Documentation — `CLAUDE.md` + `.env.example`

**Files:**

- Modify: `CLAUDE.md` (the file backing the `AGENTS.md` symlink)
- Modify: `.env.example`

**Interfaces:** None — this task is documentation only.

- [ ] **Step 1: Extend the Authentication section in `CLAUDE.md`**

In `CLAUDE.md`, locate the `## Authentication` section. Append a new `### Mobile client (iOS)` subsection at the end of that section (before the next top-level `##` heading):

````md
### Mobile client (iOS)

Vela Mobile authenticates against the same Cognito user pool as the web app, through a dedicated **public** app client (`vela-mobile-client`). The mobile OAuth flow uses authorization-code grant + PKCE; no client secret is bundled in the app binary.

The iOS callback uses a custom URL scheme registered in `apps/vela-mobile/src-capacitor/ios/App/App/Info.plist`:

| URI                                        | Purpose                                              |
| ------------------------------------------ | ---------------------------------------------------- |
| `dev.cwchanap.vela.oauth://oauth/callback` | Receives the authorization code after Google sign-in |
| `dev.cwchanap.vela.oauth://oauth/logout`   | Receives the redirect after Cognito sign-out         |

The scheme is rooted at `cwchanap.dev` (a project-controlled domain) rather than the bundle id, because `vela.app` is not a controlled namespace and custom URL schemes are an unowned namespace on iOS.

`AppDelegate.application(_:open:options:)` already forwards opens to Capacitor's `ApplicationDelegateProxy`. This is only relevant if the M2 client-side flow uses `@capacitor/browser` + `@capacitor/app` — if M2 uses `ASWebAuthenticationSession` instead, the callback arrives through the session's completion handler and `AppDelegate` is bypassed entirely.

CDK env vars (defaults shown):

```dotenv
COGNITO_MOBILE_CALLBACK_URLS=dev.cwchanap.vela.oauth://oauth/callback
COGNITO_MOBILE_LOGOUT_URLS=dev.cwchanap.vela.oauth://oauth/logout
```

Both accept comma-separated lists for dev/QA overrides. **Override URIs must use the `dev.cwchanap.vela.oauth://` scheme** — CDK validates this at synth time and throws otherwise, because iOS only registers that one scheme. Vary the path, not the scheme. The mobile client ID is published as the `CognitoMobileUserPoolClientId` CloudFormation output.

The following M2 work is required before the mobile OAuth flow can complete end-to-end (out of scope for HPA-203):

1. Widen the API JWT verifier to accept both web and mobile client audiences (`aws-jwt-verify` `clientId: [webId, mobileId]`).
2. Wire the mobile client ID into the Capacitor build.
3. If API calls go through WKWebView, add `capacitor://localhost` to the API CORS allow-list.
4. Implement PKCE + `state` + `nonce` in the client-side OAuth flow.
````

- [ ] **Step 2: Add the CDK deploy-time block to `.env.example`**

In the root `.env.example`, locate the existing `CORS_ALLOWED_EXTENSION_IDS` line (line 29). Immediately after it, insert:

```dotenv

# CDK deploy-time only (not read by the Quasar apps; do not mirror into apps/*/.env.example)
# Override URIs MUST use the dev.cwchanap.vela.oauth:// scheme — CDK throws at synth time otherwise.
COGNITO_MOBILE_CALLBACK_URLS=dev.cwchanap.vela.oauth://oauth/callback
COGNITO_MOBILE_LOGOUT_URLS=dev.cwchanap.vela.oauth://oauth/logout
```

(The leading blank line preserves visual separation from the CORS block above.)

- [ ] **Step 3: Sanity-check the symlink still resolves**

Run: `readlink AGENTS.md`
Expected: prints `CLAUDE.md` — confirms the symlink is intact and `AGENTS.md` readers will see the new section.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md .env.example
git commit -m "docs: document mobile OAuth client and iOS URL scheme (HPA-203)

- Add a Mobile client (iOS) subsection to CLAUDE.md's Authentication
  section covering the scheme choice, callback/logout URIs, env-var
  override constraints, and explicit M2 prerequisites (verifier
  widening, client ID injection, CORS, PKCE/state/nonce).
- Add COGNITO_MOBILE_CALLBACK_URLS / COGNITO_MOBILE_LOGOUT_URLS to the
  root .env.example under a CDK deploy-time-only comment block, placed
  after the existing CORS_ALLOWED_* deploy-time vars."
```

---

## Verification

After all four tasks are complete:

- [ ] **Final check 1:** Run the full CDK test suite: `bun test` from `packages/cdk/`. All tests pass (existing 12 + new mobile-client tests + new StaticWebStack test).
- [ ] **Final check 2:** Run the mobile test suite: `bun test` from `apps/vela-mobile/`. The new Info.plist test passes alongside all existing tests.
- [ ] **Final check 3:** Run `cdk:synth` from `packages/cdk/`. Confirm the synthesised templates contain:
  - Three `AWS::Cognito::UserPoolClient` resources named `vela-web-client`, `vela-test-client`, `vela-mobile-client` in `AuthStack`.
  - A `CognitoMobileUserPoolClientId` output in `StaticWebStack` whose `Value` is an `Fn::ImportValue` of the AuthStack export for `VelaMobileUserPoolClient`.
- [ ] **Final check 4:** Confirm `AGENTS.md` still symlinks to `CLAUDE.md` and shows the new "Mobile client (iOS)" subsection.
- [ ] **Final check 5:** Confirm the bundle id is unchanged (`com.vela.app`) — only the OAuth scheme is `dev.cwchanap.vela.oauth`. Check `capacitor.config.json` was not modified.
