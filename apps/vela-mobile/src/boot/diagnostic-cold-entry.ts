import { defineBoot } from '#q-app/wrappers';
import { consumeDiagnosticColdEntry } from 'src/diagnostics/cold-entry';

export default defineBoot(async ({ router }) => {
  await consumeDiagnosticColdEntry(router, window.localStorage);
});
