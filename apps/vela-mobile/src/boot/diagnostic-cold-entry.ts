import { defineBoot } from '#q-app/wrappers';
import { isNavigationFailure } from 'vue-router';
import { consumeDiagnosticColdEntry } from 'src/diagnostics/cold-entry';

export default defineBoot(async ({ router }) => {
  try {
    await consumeDiagnosticColdEntry(router, window.localStorage);
  } catch (error) {
    // consumeDiagnosticColdEntry removes the staged entry before attempting
    // router.replace, so a failed navigation cannot replay on the next boot.
    // Swallow expected navigation failures (aborted/cancelled/guard-rejected)
    // and any guard-thrown error here at the boot boundary so a stale
    // diagnostic entry never interrupts app startup — the app falls through
    // to its default route. Unexpected (non-navigation) errors are logged but
    // still suppressed, since the cold entry is a best-effort diagnostic
    // convenience rather than a critical startup step.
    if (!isNavigationFailure(error)) {
      console.warn('[diagnostic-cold-entry] cold-entry navigation failed', error);
    }
  }
});
