# Google-Only Authentication Design

## Context

Vela currently uses AWS Amplify with an existing Cognito user pool for email and password signup, email and password sign-in, password reset, and Cognito token retrieval. The Vue app sends Cognito ID tokens to the Hono API, where `aws-jwt-verify` validates those tokens. The browser extension imports the web app's Cognito tokens from local storage and uses the same API token contract.

The new requirement is to make Vela Google-only. There are no active users, so account migration, account linking, and old password-user preservation are out of scope.

## Goals

- Replace password signup and password login with Google-only sign-in.
- Keep Cognito as the token issuer so the API and extension token contracts stay stable.
- Remove user-facing signup, password, forgot-password, verification, and auto-confirm behavior from the app flow.
- Configure Cognito Hosted UI OAuth through infrastructure rather than hard-coding identity-provider details in app code.
- Keep protected-route redirects and profile creation working after the Google OAuth redirect returns.

## Non-Goals

- Migrating existing password users or linking old Cognito identities to Google identities.
- Replacing Cognito with direct Google Identity Services.
- Adding additional social providers.
- Reworking API authorization beyond the minimum needed to keep validating Cognito ID tokens.

## Chosen Approach

Use Cognito Hosted UI with Google as the only supported identity provider.

This preserves the current trust boundary: the frontend uses Amplify, Cognito issues ID tokens, the API verifies Cognito ID tokens, and the extension imports Cognito tokens from the web app. It avoids the broader API and extension changes that direct Google token verification would require.

## Infrastructure Design

`packages/cdk/lib/auth-stack.ts` will own the Google-only Cognito setup:

- Add a Cognito hosted domain for OAuth redirects.
- Add `UserPoolIdentityProviderGoogle` to the user pool.
- Read the Google OAuth client ID and client secret from deployment configuration. The secret must not be exposed to the frontend; Secrets Manager is preferred for deployed environments, with an environment-variable fallback acceptable for local CDK synthesis if documented.
- Configure the user-pool client for authorization-code OAuth.
- Set callback URLs for local and production app routes:
  - `http://localhost:9000/auth/callback`
  - `http://127.0.0.1:9000/auth/callback`
  - `https://vela.cwchanap.dev/auth/callback`
- Set logout URLs for local and production auth routes:
  - `http://localhost:9000/auth/login`
  - `http://127.0.0.1:9000/auth/login`
  - `https://vela.cwchanap.dev/auth/login`
- Allow OAuth scopes `openid`, `email`, and `profile`.
- Restrict supported identity providers to Google.

The user pool no longer needs self-signup or password auth flows for the intended app path. If Cognito requires some password settings to exist at the pool level, they can remain as inert infrastructure details, but password flows should not be enabled on the client used by the app.

## Frontend Configuration

`apps/vela/src/config/index.ts` will expose frontend-safe OAuth configuration:

- Cognito user pool ID.
- Cognito user pool client ID.
- AWS region.
- Cognito OAuth domain.
- Redirect sign-in URLs.
- Redirect sign-out URLs.

`apps/vela/src/services/authService.ts` will configure Amplify Auth with `loginWith.oauth`, using:

- `domain` from config.
- `scopes: ['openid', 'email', 'profile']`.
- `redirectSignIn` and `redirectSignOut` from config.
- `responseType: 'code'`.
- `providers: ['Google']`.

The app should import the Amplify OAuth listener path if the redirect flow requires it in this runtime.

## App Auth Flow

`AuthForm.vue` becomes a Google-only sign-in panel:

- Show one primary button: `Continue with Google`.
- Remove username, email, password, password visibility, sign-up toggle, forgot-password, and reset-password dialog.
- On click, call `authStore.signInWithGoogle()`.
- Show `authStore.error` if redirect initiation fails.
- Disable the button while auth is loading.

`LoginPage.vue` treats `/auth/login`, `/auth/signup`, and `/auth/callback` as the same Google-only entry surface:

- Preserve the existing `redirect` query parameter.
- On mount, initialize the auth store.
- If a Cognito session exists, route to the requested redirect target.
- Do not switch into a signup mode based on `/auth/signup`; that route should remain only as legacy compatibility.

`authService.ts` owns auth-provider integration:

- Add `signInWithGoogle()` that calls `signInWithRedirect({ provider: 'Google' })`.
- Keep `getCurrentSession()`, `getCurrentUser()`, `signOut()`, and `onAuthStateChange()`.
- After a successful OAuth sign-in, fetch the current user and user attributes, then ensure the Vela profile exists.
- Remove the old signup auto-confirm path from the intended app flow.

`stores/auth.ts` owns app auth state:

- Add `signInWithGoogle()` that manages loading and errors around the service call.
- Remove user-facing signup, confirm-signup, resend-code, and password-reset actions unless a short implementation transition requires temporary compatibility for tests.
- Keep sign-out cache clearing and profile-loading behavior.

## API And Extension Impact

The API should continue verifying Cognito ID tokens. Google is upstream of Cognito, not a direct API token issuer, so the API middleware should not switch to Google JWT verification.

The browser extension should not need a first-pass auth UI change. It imports Cognito tokens from the web app local-storage contract. Verification should confirm that Hosted UI sign-in still leaves Amplify-managed Cognito token entries readable by the existing extension content script. If Amplify changes the local-storage key shape for OAuth users, update the extension token importer without changing the API contract.

The API `/auth/auto-confirm` endpoint exists to bypass old password signup confirmation. It should be removed from the intended app flow. Removing the route itself can be done in this implementation if tests and extension code do not depend on it; otherwise, it should be marked as dead legacy code and removed in the same auth cleanup branch.

## Error Handling

- Missing frontend OAuth config should produce a clear auth error on the login page instead of rendering a broken password form.
- If Google redirect initiation fails, `authStore.error` should explain that Google sign-in could not start.
- If the redirect returns but Amplify cannot resolve a Cognito session, the user should remain on the auth surface.
- If profile creation or profile loading fails after a valid Cognito session, the app should keep the user signed in and show the existing profile-load error path.

## Testing Plan

Unit tests:

- `AuthForm.test.ts`: assert only the Google button and auth error surface render; assert no email, password, signup, or reset-password controls render; assert the button calls `authStore.signInWithGoogle()`.
- `authService.test.ts`: mock `signInWithRedirect`; assert Google provider usage; assert OAuth auth events still create or load profiles.
- `auth.test.ts`: assert `signInWithGoogle()` loading and error behavior; remove or replace password signup expectations.
- `LoginPage.test.ts` and router tests: assert `/auth/signup` remains compatible but does not trigger a signup form; assert protected-route redirect preservation still works.

Infrastructure verification:

- Run CDK synthesis and inspect the generated Cognito client/identity-provider resources.
- Assert or manually verify the generated client uses authorization-code OAuth, Google identity provider support, and the expected callback and logout URLs.

Runtime smoke:

- Start the Quasar app.
- Open `/auth/login` and confirm the only auth action is `Continue with Google`.
- Open a protected route while signed out and confirm the login redirect keeps the original target in the query.
- If Google/Cognito credentials are available, complete one real OAuth round trip and confirm a profile is created and API calls still send Cognito ID tokens.

Primary commands after implementation:

```bash
bun run test:unit
bun run build
```

From `packages/cdk`:

```bash
bun cdk:synth
```

## Open Operational Requirement

Before deployment, the Google OAuth app must be configured with the Cognito hosted-domain callback URL that Cognito requires for federated Google sign-in. The exact callback URL depends on the hosted domain chosen in CDK and should be copied from the synthesized or deployed Cognito domain configuration.
