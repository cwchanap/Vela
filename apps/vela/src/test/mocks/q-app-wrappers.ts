// Mock for Quasar's #q-app/wrappers
// defineRouter is just a wrapper that calls the function passed to it
export function defineRouter(fn: Function) {
  return fn;
}
