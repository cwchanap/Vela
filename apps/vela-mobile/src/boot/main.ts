import { defineBoot } from '#q-app/wrappers';

export default defineBoot(() => {
  if (import.meta.env.DEV) {
    console.log('Vela Mobile boot initialized');
  }
});
