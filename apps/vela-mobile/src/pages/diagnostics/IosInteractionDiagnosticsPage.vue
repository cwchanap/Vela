<template>
  <q-page
    padding
    class="mobile-safe-x ios-interaction-page"
    :data-testid="IOS_INTERACTION_DIAGNOSTICS_MARKER"
    @pointerdown.self="dismissFocusedControl"
  >
    <section class="column q-gutter-md">
      <h1 class="text-h5">iOS Interaction Diagnostics</h1>

      <p>
        日本語キーボードでかなを入力し、変換候補から漢字を選びます。確定前後の値と Done・Submit
        の動作を確認してください。
      </p>

      <div class="japanese-samples" aria-label="Selectable Japanese samples">
        <p>かな</p>
        <p>カタカナ</p>
        <p>日本語</p>
        <p>日本語を勉強しています。</p>
      </div>

      <section aria-label="Scroll stress content before input">
        <p>
          Scroll checkpoint A: keep this text above the form so the keyboard must preserve a useful
          viewport.
        </p>
        <p>
          Scroll checkpoint B: select the Japanese samples, focus the field, and verify the input
          block remains visible.
        </p>
        <p>
          Scroll checkpoint C: rotate the device before and after opening the keyboard to check
          relayout.
        </p>
      </section>

      <JapaneseInputProbe data-keyboard-scroll-block />

      <section aria-label="Scroll stress content after input">
        <p>
          Scroll checkpoint D: keep this content below the form to exercise keyboard dismissal near
          the bottom edge.
        </p>
        <p>
          Scroll checkpoint E: dismiss the keyboard, scroll back to the samples, and confirm text
          selection still works.
        </p>
        <p>
          Scroll checkpoint F: repeat after a route change and after returning with the native back
          gesture.
        </p>
      </section>

      <section aria-label="Diagnostic state" class="column q-gutter-xs">
        <div data-testid="current-route">Current route: {{ route.fullPath }}</div>
        <div data-testid="mobile-depth">Mobile depth: {{ mobileDepth }}</div>
        <div data-testid="keyboard-visible">
          Keyboard visible: {{ isKeyboardVisible ? 'yes' : 'no' }}
        </div>
        <div data-testid="keyboard-status">Keyboard status: {{ nativeStatus }}</div>
        <div data-testid="keyboard-error">Keyboard error: {{ lastError ?? 'none' }}</div>
        <div data-testid="orientation">Orientation: {{ orientation }}</div>
        <div data-testid="resume-count">
          Resume count: {{ mobileLifecycleState.resumeCount.value }}
        </div>
        <div data-testid="navigation-outcome">{{ lastNavigationOutcome }}</div>
      </section>

      <q-btn
        data-testid="navigate-detail"
        class="mobile-touch-target"
        label="Navigate to detail"
        @click="openDetail"
      />
      <q-btn
        data-testid="simulate-entry"
        class="mobile-touch-target"
        label="Enter detail in this session"
        @click="simulateEntry"
      />
      <q-btn
        data-testid="stage-cold-entry"
        class="mobile-touch-target"
        label="Stage cold entry"
        @click="stageColdEntry"
      />
    </section>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useRoute, useRouter } from 'vue-router';
import { stageDiagnosticColdEntry } from 'src/boot/diagnostic-cold-entry';
import JapaneseInputProbe from 'src/components/mobile/JapaneseInputProbe.vue';
import { useKeyboardViewport } from 'src/composables/useKeyboardViewport';
import { IOS_INTERACTION_DIAGNOSTICS_MARKER } from 'src/diagnostics/ios-interaction-contract';
import { IOS_DIAGNOSTIC_DETAIL_PATH, IOS_DIAGNOSTIC_ROOT_PATH } from 'src/router/diagnostic-routes';
import {
  enterMobileRoute,
  pushMobileRoute,
  readMobileDepth,
  type MobileNavigationResult,
} from 'src/router/mobile-navigation';
import { mobileLifecycleState } from 'src/services/mobile-lifecycle';

const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const allowedDiagnosticEntries = new Set([IOS_DIAGNOSTIC_ROOT_PATH, IOS_DIAGNOSTIC_DETAIL_PATH]);
const lastNavigationOutcome = ref('none');
const mobileDepth = computed(() => readMobileDepth(router));
const orientation = computed(() =>
  $q.screen.width >= $q.screen.height ? 'landscape' : 'portrait',
);
const { isKeyboardVisible, nativeStatus, lastError } = useKeyboardViewport();

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

const openDetail = () =>
  recordNavigation('push-detail', () => pushMobileRoute(router, IOS_DIAGNOSTIC_DETAIL_PATH));

const simulateEntry = () =>
  recordNavigation('entry-detail', () =>
    enterMobileRoute(router, IOS_DIAGNOSTIC_DETAIL_PATH, allowedDiagnosticEntries),
  );

function stageColdEntry(): void {
  stageDiagnosticColdEntry(window.localStorage, IOS_DIAGNOSTIC_DETAIL_PATH);
  lastNavigationOutcome.value = `cold-entry:staged:${IOS_DIAGNOSTIC_DETAIL_PATH}`;
}

function dismissFocusedControl(): void {
  (document.activeElement as HTMLElement | null)?.blur();
}
</script>

<style scoped>
.japanese-samples {
  user-select: text;
  -webkit-user-select: text;
}
</style>
