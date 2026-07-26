<template>
  <q-page class="flex flex-center">
    <div class="text-center q-pa-xl">
      <q-icon name="more_horiz" size="48px" color="primary" />
      <h2 class="text-h5 text-weight-medium q-mt-md">More</h2>
      <p class="text-body2 text-grey-6">Coming soon</p>
      <q-list>
        <q-item
          v-if="config.app.isDev"
          clickable
          class="mobile-touch-target"
          data-testid="ios-interaction-entry"
          @click="openDiagnostics"
        >
          <q-item-section avatar><q-icon name="developer_mode" /></q-item-section>
          <q-item-section>
            <q-item-label>iOS Interaction Diagnostics</q-item-label>
            <q-item-label caption>IME, keyboard, safe areas, and navigation</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { config } from 'src/config';
import { IOS_DIAGNOSTIC_ROOT_PATH } from 'src/router/diagnostic-routes';
import { pushMobileRoute } from 'src/router/mobile-navigation';

const router = useRouter();

function openDiagnostics(): void {
  void pushMobileRoute(router, IOS_DIAGNOSTIC_ROOT_PATH).catch((error: unknown) => {
    console.error('Opening iOS interaction diagnostics failed', error);
  });
}
</script>
