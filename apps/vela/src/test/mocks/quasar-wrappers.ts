// Mock for Quasar's quasar/wrappers
// boot returns the provided callback unchanged so tests can control when boot runs.
export function boot(fn: Function) {
  return fn;
}
