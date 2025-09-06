import { Amplify } from 'aws-amplify';
import { config } from '../config';

export function configureAmplify() {
  if (config.authProvider !== 'cognito') return;

  const { userPoolId, userPoolClientId, region } = config.cognito;
  if (!userPoolId || !userPoolClientId || !region) {
    console.warn('Cognito config incomplete. Skipping Amplify configuration.');
    return;
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
}
