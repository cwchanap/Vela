import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { defineBoot } from '#q-app/wrappers';
import { recordAppResume } from 'src/services/mobile-lifecycle';

export type ResumeAppAdapter = {
  addListener(eventName: 'resume', listener: () => void): Promise<PluginListenerHandle>;
};

let registered = false;

export async function registerCapacitorLifecycle(adapter: ResumeAppAdapter = App): Promise<void> {
  if (registered) return;
  await adapter.addListener('resume', () => recordAppResume());
  registered = true;
}

export function resetCapacitorLifecycleForTests(): void {
  registered = false;
}

export default defineBoot(async () => {
  await registerCapacitorLifecycle();
});
