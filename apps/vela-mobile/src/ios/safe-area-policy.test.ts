import { describe, expect, it } from 'vitest';
import capacitorConfig from '../../src-capacitor/capacitor.config.ts';
import { safeAreaPolicy } from './safe-area-policy';

describe('safeAreaPolicy', () => {
  it('matches the native content-inset configuration', () => {
    expect(capacitorConfig.ios?.contentInset).toBe(safeAreaPolicy.contentInset);
  });

  it('uses the only valid headerless-top owner for the selected mode', () => {
    expect(safeAreaPolicy).toEqual(
      capacitorConfig.ios?.contentInset === 'always'
        ? {
            contentInset: 'always',
            headerlessTopOwner: 'native-scroll-view',
          }
        : {
            contentInset: 'never',
            headerlessTopOwner: 'css',
          },
    );
  });
});
