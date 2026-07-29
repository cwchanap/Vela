/**
 * Pure validation helpers shared by the build-time mobile env validator
 * (`build/validate-mobile-api-url.ts`), the runtime config validator
 * (`src/config/index.ts`), and the mobile auth coordinator's `hasValidConfig`
 * (`src/services/mobile-auth.ts`). Keeping these in one module guarantees the
 * build-time, boot-time, and coordinator-time checks agree on what a valid
 * Cognito/OAuth configuration looks like.
 */

export function containsWhitespace(value: string): boolean {
  return /\s/u.test(value);
}

export function isValidHostOnlyDomain(value: string): boolean {
  try {
    const url = new URL(`https://${value}`);
    return (
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.pathname === '/' &&
      url.hostname.toLowerCase() === value.toLowerCase()
    );
  } catch {
    return false;
  }
}

export function hasMatchingUserPoolRegion(userPoolId: string, region: string): boolean {
  const separatorIndex = userPoolId.indexOf('_');
  if (separatorIndex <= 0 || userPoolId.slice(0, separatorIndex) !== region) {
    return false;
  }
  const suffix = userPoolId.slice(separatorIndex + 1);
  return suffix.length > 0 && !suffix.includes('_');
}
