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
});
