import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { defineBoot } from '#q-app/wrappers';
import { recordAppResume } from 'src/services/mobile-lifecycle';

export type ResumeAppAdapter = {
  addListener(eventName: 'resume', listener: () => void): Promise<PluginListenerHandle>;
};

let registered = false;
let registration: Promise<void> | null = null;

export async function registerCapacitorLifecycle(adapter: ResumeAppAdapter = App): Promise<void> {
  if (registered) return;
  if (registration !== null) return registration;
  registration = adapter
    .addListener('resume', () => recordAppResume())
    .then(() => {
      registered = true;
    })
    .catch((error: unknown) => {
      registration = null;
      throw error;
    });
  return registration;
}

export function resetCapacitorLifecycleForTests(): void {
  registered = false;
  registration = null;
}

export default defineBoot(async () => {
  // recordAppResume only bumps a diagnostics counter; a failed native
  // listener subscription must not block app launch. The registration
  // promise is still cached so a later explicit caller can observe the
  // failure, but the boot path swallows it.
  await registerCapacitorLifecycle().catch((error: unknown) => {
    console.error('Capacitor resume listener registration failed', error);
  });
});
