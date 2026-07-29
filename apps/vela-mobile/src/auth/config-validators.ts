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
  // Amazon Cognito UserPoolId: max length 55, pattern `[\w-]+_[0-9a-zA-Z]+`
  // (https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_UserPoolType.html)
  // The suffix must be strictly alphanumeric — no punctuation, no Unicode,
  // no additional underscores. We split on the FIRST underscore (the region
  // separator) and require the remainder to match `[A-Za-z0-9]+`; the AWS
  // pattern's `[\w-]+` prefix is looser, but real AWS regions never contain
  // underscores, so splitting on the first underscore matches real Cognito
  // IDs and rejects malformed values like `us-east-1_foo_bar` that the loose
  // pattern would accept. This helper guards the build-time, boot-time, and
  // coordinator-time config checks, so it must reject every malformed value.
  if (userPoolId.length > 55) {
    return false;
  }
  const separatorIndex = userPoolId.indexOf('_');
  if (separatorIndex <= 0) {
    return false;
  }
  const prefix = userPoolId.slice(0, separatorIndex);
  const suffix = userPoolId.slice(separatorIndex + 1);
  // Validate the prefix independently so a malformed prefix cannot slip through
  // by matching an equally malformed `region` env value. Real AWS regions are
  // lowercase ASCII letters, digits, and hyphens only — no underscores (which
  // would also break the first-underscore split), no punctuation, no Unicode.
  return prefix === region && /^[A-Za-z0-9-]+$/u.test(prefix) && /^[A-Za-z0-9]+$/u.test(suffix);
}
