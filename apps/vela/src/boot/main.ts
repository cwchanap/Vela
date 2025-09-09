import { boot } from 'quasar/wrappers';
import { configureAmplify } from '../services/amplify';
import { config } from '../config';

export default boot(() => {
  // Boot file for additional app initialization
  // Pinia is now initialized via stores/index.ts
  if (config.authProvider === 'cognito') {
    const configured = configureAmplify();
    if (configured) {
      console.log('✅ Amplify configured for Cognito');
    } else {
      console.warn('⚠️ Amplify configuration failed - check environment variables');
    }
  }
  console.log('✅ App boot initialized');
});
