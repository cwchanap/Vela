<template>
  <q-page class="flex flex-center">
    <q-card class="q-ma-md" style="max-width: 400px; width: 100%">
      <q-card-section>
        <div class="text-h6">Mystery Messenger</div>
        <div class="text-subtitle2 text-grey-6">The Message That Arrived Tomorrow</div>
        <p class="text-body2 q-mt-sm q-mb-md">
          A five-scene pilot where your choices shape the ending.
        </p>
        <q-btn
          data-testid="mystery-messenger-entry"
          color="primary"
          label="Play pilot"
          @click="openMysteryMessenger"
        />
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { pushMobileRoute } from 'src/router/mobile-navigation';

const router = useRouter();

function openMysteryMessenger(): void {
  void pushMobileRoute(router, '/learn/mystery-messenger').catch((error: unknown) => {
    console.error('Mystery Messenger navigation failed', error);
  });
}
</script>
