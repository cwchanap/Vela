import { describe, expect, it } from 'vitest';
import { getMobileBootFiles } from './boot-files';

describe('mobile boot files', () => {
  it('includes native lifecycle only in Capacitor mode', () => {
    expect(getMobileBootFiles({ isCapacitor: true, isDevelopment: false })).toEqual([
      'main',
      'query',
      'mobile-auth',
      'capacitor-lifecycle',
    ]);
  });

  it('includes cold entry only in development', () => {
    expect(getMobileBootFiles({ isCapacitor: false, isDevelopment: true })).toEqual([
      'main',
      'query',
      'mobile-auth',
      'diagnostic-cold-entry',
    ]);
  });

  it('orders auth before native lifecycle and cold entry in Capacitor development', () => {
    expect(getMobileBootFiles({ isCapacitor: true, isDevelopment: true })).toEqual([
      'main',
      'query',
      'mobile-auth',
      'capacitor-lifecycle',
      'diagnostic-cold-entry',
    ]);
  });

  it('includes auth immediately after main in browser production', () => {
    expect(getMobileBootFiles({ isCapacitor: false, isDevelopment: false })).toEqual([
      'main',
      'query',
      'mobile-auth',
    ]);
  });
});
