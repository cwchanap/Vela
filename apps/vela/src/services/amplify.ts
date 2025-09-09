import { Amplify } from 'aws-amplify';
import { config } from '../config';

export function configureAmplify(): boolean {
  if (config.authProvider !== 'cognito') return false;

  const { userPoolId, userPoolClientId, region } = config.cognito;
  if (!userPoolId || !userPoolClientId || !region) {
    console.warn('Cognito config incomplete. Skipping Amplify configuration.');
    return false;
  }

  const amplifyConfig: any = {
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: {
          email: true,
        },
        signUpVerificationMethod: 'code',
        allowGuestAccess: false,
      },
    },
  };
  Amplify.configure(amplifyConfig);
  return true;
}
