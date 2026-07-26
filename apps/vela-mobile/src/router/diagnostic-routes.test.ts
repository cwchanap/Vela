import { describe, expect, it } from 'vitest';
import {
  IOS_DIAGNOSTIC_DETAIL_PATH,
  IOS_DIAGNOSTIC_ROOT_PATH,
  IOS_INTERACTION_DIAGNOSTICS_LABEL,
} from 'src/diagnostics/ios-interaction-contract';
import { buildMobileChildRoutes, developmentDiagnosticRoutes } from './diagnostic-routes';

describe('diagnostic route construction', () => {
  it('adds the two diagnostic routes in development', () => {
    const paths = buildMobileChildRoutes(developmentDiagnosticRoutes).map((route) => route.path);
    expect(paths).toContain(IOS_DIAGNOSTIC_ROOT_PATH.slice(1));
    expect(paths).toContain(IOS_DIAGNOSTIC_DETAIL_PATH.slice(1));
  });

  it('keeps production construction at the five shell routes', () => {
    expect(buildMobileChildRoutes([])).toHaveLength(5);
  });

  it('declares exact header metadata and fallbacks', () => {
    expect(developmentDiagnosticRoutes[0]?.meta?.mobileHeader).toEqual({
      title: IOS_INTERACTION_DIAGNOSTICS_LABEL,
      fallback: '/more',
    });
    expect(developmentDiagnosticRoutes[1]?.meta?.mobileHeader).toEqual({
      title: 'Navigation Detail',
      fallback: IOS_DIAGNOSTIC_ROOT_PATH,
    });
  });
});
