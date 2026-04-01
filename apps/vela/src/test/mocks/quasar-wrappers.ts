// Mock for Quasar's quasar/wrappers
// boot is just a wrapper that calls the function passed to it
export function boot(fn: Function) {
  return fn;
}
