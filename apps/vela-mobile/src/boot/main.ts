import { boot } from 'quasar/wrappers';

export default boot(() => {
  if (import.meta.env.DEV) {
    console.log('Vela Mobile boot initialized');
  }
});
