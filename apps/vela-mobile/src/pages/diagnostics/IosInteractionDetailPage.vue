<template>
  <q-page padding class="mobile-safe-x">
    <section class="column q-gutter-md">
      <h1 class="text-h5">Navigation Detail</h1>
      <p data-testid="detail-route-identity">This is the nested iOS interaction route.</p>
      <q-btn
        data-testid="repeat-detail-navigation"
        class="mobile-touch-target"
        label="Navigate to this detail again"
        @click="repeatCurrentRoute"
      />
      <q-btn
        data-testid="simulate-entry-again"
        class="mobile-touch-target"
        label="Deliver this route entry again"
        @click="repeatRouteEntry"
      />
      <q-btn
        data-testid="simulate-resume"
        class="mobile-touch-target"
        label="Simulate resume"
        @click="simulateResume"
      />
      <div data-testid="detail-navigation-outcome">Last outcome: {{ lastNavigationOutcome }}</div>
      <p>
        Test the visible header back control, native left-edge swipe-back, and native swipe-forward
        from this page.
      </p>
    </section>
  </q-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IOS_DIAGNOSTIC_DETAIL_PATH,
  IOS_DIAGNOSTIC_ROOT_PATH,
} from 'src/diagnostics/ios-interaction-contract';
import {
  enterMobileRoute,
  pushMobileRoute,
  type MobileNavigationResult,
} from 'src/router/mobile-navigation';
import { recordAppResume } from 'src/services/mobile-lifecycle';

const route = useRoute();
const router = useRouter();
const allowedDiagnosticEntries = new Set([IOS_DIAGNOSTIC_ROOT_PATH, IOS_DIAGNOSTIC_DETAIL_PATH]);
const lastNavigationOutcome = ref('none');

async function recordNavigation(
  label: string,
  action: () => Promise<MobileNavigationResult>,
): Promise<void> {
  try {
    const result = await action();
    lastNavigationOutcome.value = `${label}:${result.kind}:${result.fullPath}:depth=${result.depth}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastNavigationOutcome.value = `${label}:failed:${message}`;
    console.error(`Diagnostic navigation failed (${label})`, error);
  }
}

const repeatCurrentRoute = () =>
  recordNavigation('repeat-push', () => pushMobileRoute(router, IOS_DIAGNOSTIC_DETAIL_PATH));

const repeatRouteEntry = () =>
  recordNavigation('repeat-entry', () =>
    enterMobileRoute(router, IOS_DIAGNOSTIC_DETAIL_PATH, allowedDiagnosticEntries),
  );

function simulateResume(): void {
  recordAppResume();
  lastNavigationOutcome.value = `resume:preserved:${route.fullPath}`;
}
</script>
