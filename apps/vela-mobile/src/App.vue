<template>
  <MobileAuthGate>
    <router-view />
  </MobileAuthGate>
</template>

<script setup lang="ts">
import { inject, onUnmounted } from 'vue';
import { mobileQueryClient } from './boot/query';
import MobileAuthGate from './components/mobile/MobileAuthGate.vue';
import { MOBILE_AUTH_KEY } from './services/mobile-auth';
import { installMobileQueryAuthIsolation } from './services/mobile-query-auth-isolation';

const coordinator = inject(MOBILE_AUTH_KEY);
if (!coordinator) throw new Error('Mobile auth coordinator was not provided');

const stopIsolation = installMobileQueryAuthIsolation({
  state: coordinator.state,
  queryClient: mobileQueryClient,
});
onUnmounted(stopIsolation);
</script>
