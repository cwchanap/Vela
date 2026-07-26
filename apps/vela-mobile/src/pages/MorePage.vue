<template>
  <q-page class="flex flex-center">
    <div class="text-center q-pa-xl">
      <q-icon name="more_horiz" size="48px" color="primary" />
      <h2 class="text-h5 text-weight-medium q-mt-md">More</h2>
      <p class="text-body2 text-grey-6">Coming soon</p>
      <q-list>
        <q-item
          v-for="entry in diagnosticEntries"
          :key="entry.path"
          clickable
          class="mobile-touch-target"
          data-testid="ios-interaction-entry"
          @click="entry.open"
        >
          <q-item-section avatar><q-icon :name="entry.icon" /></q-item-section>
          <q-item-section>
            <q-item-label>{{ entry.label }}</q-item-label>
            <q-item-label caption>{{ entry.caption }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import {
  IOS_DIAGNOSTIC_ROOT_PATH,
  IOS_INTERACTION_DIAGNOSTICS_LABEL,
} from 'src/diagnostics/ios-interaction-contract';
import { pushMobileRoute } from 'src/router/mobile-navigation';

const router = import.meta.env.DEV ? useRouter() : undefined;
const diagnosticEntries = import.meta.env.DEV
  ? [
      {
        path: IOS_DIAGNOSTIC_ROOT_PATH,
        label: IOS_INTERACTION_DIAGNOSTICS_LABEL,
        caption: 'IME, keyboard, safe areas, and navigation',
        icon: 'developer_mode',
        open: () => {
          void pushMobileRoute(router!, IOS_DIAGNOSTIC_ROOT_PATH).catch((error: unknown) => {
            console.error('Opening iOS interaction diagnostics failed', error);
          });
        },
      },
    ]
  : [];
</script>
