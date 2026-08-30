import { describe, expect, it } from 'vitest';
import {
  IOS_DIAGNOSTIC_DETAIL_PATH,
  IOS_DIAGNOSTIC_ROOT_PATH,
  IOS_INTERACTION_DIAGNOSTICS_LABEL,
} from 'src/diagnostics/ios-interaction-contract';
import {
  authenticatedDevelopmentDiagnosticRoutes,
  buildMobileChildRoutes,
  bypassDevelopmentDiagnosticRoutes,
  developmentDiagnosticRoutes,
} from './diagnostic-routes';

describe('diagnostic route construction', () => {
  it('adds the diagnostic routes in development', () => {
    const paths = buildMobileChildRoutes(developmentDiagnosticRoutes).map((route) => route.path);
    expect(paths).toContain(IOS_DIAGNOSTIC_ROOT_PATH.slice(1));
    expect(paths).toContain(IOS_DIAGNOSTIC_DETAIL_PATH.slice(1));
    expect(paths).toContain('diagnostics/tts-pronunciation');
  });

  it('keeps production construction at the six authenticated core routes', () => {
    const productionRoutes = buildMobileChildRoutes([]);
    expect(productionRoutes).toHaveLength(6);
    expect(productionRoutes.map((route) => route.path)).not.toContain(
      IOS_DIAGNOSTIC_ROOT_PATH.slice(1),
    );
    expect(productionRoutes.map((route) => route.path)).not.toContain(
      IOS_DIAGNOSTIC_DETAIL_PATH.slice(1),
    );
    expect(productionRoutes.every((route) => route.meta?.bypassMobileAuth !== true)).toBe(true);
  });

  it('declares exact header metadata and fallbacks', () => {
    expect(bypassDevelopmentDiagnosticRoutes[0]?.meta?.mobileHeader).toEqual({
      title: IOS_INTERACTION_DIAGNOSTICS_LABEL,
      fallback: '/more',
    });
    expect(bypassDevelopmentDiagnosticRoutes[1]?.meta?.mobileHeader).toEqual({
      title: 'Navigation Detail',
      fallback: IOS_DIAGNOSTIC_ROOT_PATH,
    });
    expect(authenticatedDevelopmentDiagnosticRoutes[0]?.meta?.mobileHeader).toEqual({
      title: 'Pronunciation diagnostics',
      fallback: '/more',
    });
  });

  it('partitions bypassed and authenticated development diagnostics', () => {
    expect(bypassDevelopmentDiagnosticRoutes.length).toBeGreaterThan(0);
    expect(
      bypassDevelopmentDiagnosticRoutes.every((route) => route.meta?.bypassMobileAuth === true),
    ).toBe(true);
    expect(authenticatedDevelopmentDiagnosticRoutes).toHaveLength(1);
    expect(authenticatedDevelopmentDiagnosticRoutes[0]?.path).toBe('diagnostics/tts-pronunciation');
    expect(authenticatedDevelopmentDiagnosticRoutes[0]?.meta?.bypassMobileAuth).not.toBe(true);
    expect(developmentDiagnosticRoutes).toEqual([
      ...bypassDevelopmentDiagnosticRoutes,
      ...authenticatedDevelopmentDiagnosticRoutes,
    ]);
  });

  it('never marks core shell routes as mobile auth bypasses', () => {
    const coreRoutes = buildMobileChildRoutes([]);
    expect(coreRoutes.every((route) => route.meta?.bypassMobileAuth !== true)).toBe(true);
  });
});
