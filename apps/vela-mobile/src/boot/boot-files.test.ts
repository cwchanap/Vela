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

  it('includes both native lifecycle and cold entry in Capacitor development', () => {
    expect(getMobileBootFiles({ isCapacitor: true, isDevelopment: true })).toEqual([
      'main',
      'capacitor-lifecycle',
      'diagnostic-cold-entry',
    ]);
  });

  it('includes only main when neither flag is set', () => {
    expect(getMobileBootFiles({ isCapacitor: false, isDevelopment: false })).toEqual(['main']);
  });
});
