<template>
  <q-page class="flex flex-center">
    <div class="text-center q-pa-xl">
      <q-icon name="more_horiz" size="48px" color="primary" />
      <h2 class="text-h5 text-weight-medium q-mt-md">More</h2>
      <p class="text-body2 text-grey-6">Coming soon</p>
      <q-btn
        aria-label="Sign out of Vela"
        color="negative"
        outline
        :loading="signOutPending"
        :disable="signOutPending"
        label="Sign out"
        @click="handleSignOut"
      />
      <development-diagnostics-entry v-if="DevelopmentDiagnosticsEntry" />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { defineAsyncComponent, inject, ref } from 'vue';
import { MOBILE_AUTH_KEY } from '../services/mobile-auth';

const providedCoordinator = inject(MOBILE_AUTH_KEY);
if (!providedCoordinator) {
  throw new Error('Mobile auth coordinator was not provided');
}
const coordinator = providedCoordinator;
const signOutPending = ref(false);

async function handleSignOut(): Promise<void> {
  if (signOutPending.value) return;
  signOutPending.value = true;
  try {
    await coordinator.signOut();
  } finally {
    signOutPending.value = false;
  }
}

const DevelopmentDiagnosticsEntry = import.meta.env.DEV
  ? defineAsyncComponent(() => import('src/components/mobile/IosInteractionDiagnosticsEntry.vue'))
  : null;
</script>
