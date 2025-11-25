import { Stack } from 'aws-cdk-lib';

export function getTtsAudioBucketName(stack: Stack): string {
  return `vela-tts-audio-${stack.account}`;
}
