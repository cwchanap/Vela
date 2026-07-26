<template>
  <q-list>
    <q-item
      clickable
      class="mobile-touch-target"
      :data-testid="IOS_INTERACTION_ENTRY_TEST_ID"
      @click="openDiagnostics"
    >
      <q-item-section avatar><q-icon name="developer_mode" /></q-item-section>
      <q-item-section>
        <q-item-label>{{ IOS_INTERACTION_DIAGNOSTICS_LABEL }}</q-item-label>
        <q-item-label caption>IME, keyboard, safe areas, and navigation</q-item-label>
      </q-item-section>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import {
  IOS_DIAGNOSTIC_ROOT_PATH,
  IOS_INTERACTION_DIAGNOSTICS_LABEL,
  IOS_INTERACTION_ENTRY_TEST_ID,
} from 'src/diagnostics/ios-interaction-contract';
import { pushMobileRoute } from 'src/router/mobile-navigation';

const router = useRouter();

function openDiagnostics(): void {
  void pushMobileRoute(router, IOS_DIAGNOSTIC_ROOT_PATH).catch((error: unknown) => {
    console.error('Opening iOS interaction diagnostics failed', error);
  });
}
</script>
