import { defineBoot } from '#q-app';
import { validateConfig } from '@/config';

export default defineBoot(() => {
  validateConfig();

  if (import.meta.env.DEV) {
    console.log('Vela Mobile boot initialized');
  }
});
