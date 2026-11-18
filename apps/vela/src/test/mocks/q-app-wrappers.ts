// Mock for Quasar's #q-app wrappers
// Each wrapper returns the provided factory unchanged so tests can inspect config callbacks
// or decide when to invoke them.
export function defineConfig<T>(fn: T) {
  return fn;
}

export function defineRouter<T>(fn: T) {
  return fn;
}

export function defineBoot<T>(fn: T) {
  return fn;
}
