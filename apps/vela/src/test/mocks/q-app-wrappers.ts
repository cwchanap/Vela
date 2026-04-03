// Mock for Quasar's #q-app/wrappers
// defineRouter returns the provided factory unchanged so tests can decide when to invoke it.
export function defineRouter(fn: Function) {
  return fn;
}
