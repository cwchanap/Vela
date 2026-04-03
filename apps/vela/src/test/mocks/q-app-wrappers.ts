// Mock for Quasar's #q-app/wrappers
// defineConfig returns the provided factory unchanged so tests can inspect config callbacks.
export function defineConfig<T>(fn: T) {
  return fn;
}

// defineRouter returns the provided factory unchanged so tests can decide when to invoke it.
export function defineRouter<T>(fn: T) {
  return fn;
}
