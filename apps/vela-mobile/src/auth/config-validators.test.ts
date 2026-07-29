import { describe, expect, it } from 'vitest';
import {
  containsWhitespace,
  hasMatchingUserPoolRegion,
  isValidHostOnlyDomain,
} from './config-validators';

describe('containsWhitespace', () => {
  it('returns true for a value containing a space', () => {
    expect(containsWhitespace('us-east-1_ example')).toBe(true);
  });

  it('returns true for a value containing a tab', () => {
    expect(containsWhitespace('us-east-1\texample')).toBe(true);
  });

  it('returns false for a value with no whitespace', () => {
    expect(containsWhitespace('us-east-1_example')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(containsWhitespace('')).toBe(false);
  });
});

describe('isValidHostOnlyDomain', () => {
  it('returns true for a bare host', () => {
    expect(isValidHostOnlyDomain('vela.auth.us-east-1.amazoncognito.com')).toBe(true);
  });

  it('returns false for a value with a path', () => {
    expect(isValidHostOnlyDomain('example.com/path')).toBe(false);
  });

  it('returns false for a value with a port', () => {
    expect(isValidHostOnlyDomain('example.com:8080')).toBe(false);
  });

  it('returns false for a value with a query string', () => {
    expect(isValidHostOnlyDomain('example.com?qs=1')).toBe(false);
  });

  it('returns false for a value with credentials', () => {
    expect(isValidHostOnlyDomain('user:pass@example.com')).toBe(false);
  });
});

describe('hasMatchingUserPoolRegion', () => {
  it('returns true when the prefix matches the region and the suffix is non-empty', () => {
    expect(hasMatchingUserPoolRegion('us-east-1_abc123XYZ', 'us-east-1')).toBe(true);
  });

  it('returns true for a realistic Cognito user-pool ID shape', () => {
    expect(hasMatchingUserPoolRegion('ap-northeast-1_7m2bKQzN1', 'ap-northeast-1')).toBe(true);
  });

  it('returns false when the region prefix does not match', () => {
    expect(hasMatchingUserPoolRegion('us-west-2_abc123', 'us-east-1')).toBe(false);
  });

  it('returns false when there is no underscore separator', () => {
    expect(hasMatchingUserPoolRegion('us-east-1abc123', 'us-east-1')).toBe(false);
  });

  it('returns false when the separator is at the start of the string', () => {
    expect(hasMatchingUserPoolRegion('_abc123', '')).toBe(false);
  });

  it('returns false when the suffix is empty', () => {
    expect(hasMatchingUserPoolRegion('us-east-1_', 'us-east-1')).toBe(false);
  });

  it('returns false when the suffix contains an additional underscore segment', () => {
    expect(hasMatchingUserPoolRegion('us-east-1_foo_bar', 'us-east-1')).toBe(false);
  });

  it('returns false when the suffix contains multiple additional underscore segments', () => {
    expect(hasMatchingUserPoolRegion('us-east-1_foo_bar_baz', 'us-east-1')).toBe(false);
  });

  it('returns false for an empty user-pool ID', () => {
    expect(hasMatchingUserPoolRegion('', 'us-east-1')).toBe(false);
  });

  it('returns false when the region is empty but a suffix is present', () => {
    expect(hasMatchingUserPoolRegion('_abc123', '')).toBe(false);
  });

  it('returns false when the suffix contains punctuation (dot)', () => {
    expect(hasMatchingUserPoolRegion('us-east-1_abc.def', 'us-east-1')).toBe(false);
  });

  it('returns false when the suffix contains a hyphen', () => {
    expect(hasMatchingUserPoolRegion('us-east-1_abc-def', 'us-east-1')).toBe(false);
  });

  it('returns false when the suffix contains a non-ASCII Unicode character', () => {
    expect(hasMatchingUserPoolRegion('us-east-1_💥', 'us-east-1')).toBe(false);
  });

  it('returns false when the suffix contains a space', () => {
    expect(hasMatchingUserPoolRegion('us-east-1_abc def', 'us-east-1')).toBe(false);
  });

  it('returns false when the user-pool ID exceeds the 55-character Cognito maximum', () => {
    const longSuffix = 'a'.repeat(100);
    expect(hasMatchingUserPoolRegion(`us-east-1_${longSuffix}`, 'us-east-1')).toBe(false);
  });

  it('returns true for a user-pool ID at exactly the 55-character maximum', () => {
    // `us-east-1_` is 10 chars; suffix of 45 alphanumerics => total 55.
    const suffix = 'a'.repeat(45);
    expect(hasMatchingUserPoolRegion(`us-east-1_${suffix}`, 'us-east-1')).toBe(true);
  });

  it('returns false when the suffix contains a digit-only segment but the prefix has an invalid char', () => {
    expect(hasMatchingUserPoolRegion('us-east-1!_abc123', 'us-east-1')).toBe(false);
  });

  it('returns false when the malformed prefix equals the configured region (prefix format not validated by equality alone)', () => {
    // Both env values share the malformed prefix `us-east-1!`; without
    // independent prefix format validation this would pass.
    expect(hasMatchingUserPoolRegion('us-east-1!_abc123', 'us-east-1!')).toBe(false);
  });
});
