import { boot } from 'quasar/wrappers';

export default boot(() => {
  // Boot file for additional app initialization
  // Pinia is now initialized via stores/index.ts
  console.log('✅ App boot initialized');
});
