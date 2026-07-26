import { describe, expect, it } from 'vitest';
import { getMobileBootFiles } from './boot-files';

describe('mobile boot files', () => {
  it('includes native lifecycle only in Capacitor mode', () => {
    expect(getMobileBootFiles({ isCapacitor: true, isDevelopment: false })).toEqual([
      'main',
      'capacitor-lifecycle',
    ]);
  });

  it('includes cold entry only in development', () => {
    expect(getMobileBootFiles({ isCapacitor: false, isDevelopment: true })).toEqual([
      'main',
      'diagnostic-cold-entry',
    ]);
  });
});
