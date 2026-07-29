<script lang="ts">
import type { MobileAuthState } from '../../auth/mobile-auth-contract';

export function shouldBypassMobileAuth(
  isDevelopment: boolean,
  hasBypassMetadata: boolean,
  state: Readonly<MobileAuthState>,
): boolean {
  return (
    isDevelopment &&
    hasBypassMetadata &&
    (state.phase === 'signedOut' ||
      (state.phase === 'error' && state.errorCode === 'configuration_error'))
  );
}
</script>

<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue';
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter } from 'vue-router';
import type { MobileAuthErrorCode, MobileAuthPhase } from '../../auth/mobile-auth-contract';
import { MOBILE_AUTH_KEY } from '../../services/mobile-auth';

type ErrorAction = 'restart' | 'retrySession' | null;

type ErrorPresentation = {
  heading: string;
  message: string;
  action: ErrorAction;
  actionLabel?: string;
};

const ERROR_PRESENTATIONS: Record<MobileAuthErrorCode, ErrorPresentation> = {
  configuration_error: {
    heading: 'Vela is not configured for sign-in',
    message:
      'This build cannot start secure Google sign-in. Check the mobile configuration and secure runtime.',
    action: null,
  },
  browser_launch_failed: {
    heading: 'Google sign-in could not open',
    message: 'Vela could not open the secure Google sign-in window.',
    action: 'restart',
    actionLabel: 'Try Google sign-in again',
  },
  cancelled: {
    heading: 'Google sign-in was cancelled',
    message: 'No changes were made. You can start Google sign-in again.',
    action: 'restart',
    actionLabel: 'Try Google sign-in again',
  },
  interrupted: {
    heading: 'Google sign-in was interrupted',
    message: 'The previous sign-in did not finish. Start a new secure sign-in.',
    action: 'restart',
    actionLabel: 'Start Google sign-in again',
  },
  transaction_expired: {
    heading: 'Google sign-in expired',
    message: 'The previous sign-in request is no longer valid. Start a new one.',
    action: 'restart',
    actionLabel: 'Start Google sign-in again',
  },
  malformed_callback: {
    heading: 'Google sign-in could not be completed',
    message: 'Vela received an incomplete sign-in response. Start a new secure sign-in.',
    action: 'restart',
    actionLabel: 'Start Google sign-in again',
  },
  provider_error: {
    heading: 'Google sign-in was unsuccessful',
    message: 'The identity provider could not complete sign-in. Please try again.',
    action: 'restart',
    actionLabel: 'Try Google sign-in again',
  },
  code_exchange_failed: {
    heading: 'Google sign-in could not be completed',
    message: 'Vela could not finish the secure sign-in exchange. Please try again.',
    action: 'restart',
    actionLabel: 'Try Google sign-in again',
  },
  token_validation_failed: {
    heading: 'Google sign-in could not be verified',
    message: 'The sign-in response did not pass Vela verification. Start a new secure sign-in.',
    action: 'restart',
    actionLabel: 'Start Google sign-in again',
  },
  session_unauthorized: {
    heading: 'Vela could not authorize this session',
    message: 'The Vela API rejected this sign-in. Start a new secure sign-in.',
    action: 'restart',
    actionLabel: 'Start Google sign-in again',
  },
  session_verification_failed: {
    heading: 'Vela could not verify your session',
    message: 'The sign-in succeeded, but Vela could not confirm the API session.',
    action: 'retrySession',
    actionLabel: 'Retry session verification',
  },
};

const PROGRESS_COPY: Partial<Record<MobileAuthPhase, string>> = {
  initializing: 'Preparing secure sign-in…',
  openingBrowser: 'Opening Google sign-in…',
  awaitingCallback: 'Waiting for Google sign-in…',
  exchangingCode: 'Completing secure sign-in…',
  verifyingSession: 'Verifying your Vela session…',
};

const FOCUS_RETURN_PHASES = new Set<MobileAuthPhase>([
  'openingBrowser',
  'awaitingCallback',
  'exchangingCode',
  'verifyingSession',
]);

const LANDING_NAVIGATION_ERROR = {
  heading: 'Vela could not open your home',
  message: 'Your session is verified, but the app could not finish opening the home screen.',
  actionLabel: 'Retry opening Vela',
} as const;

const providedCoordinator = inject(MOBILE_AUTH_KEY);
if (!providedCoordinator) {
  throw new Error('Mobile auth coordinator was not provided');
}
const coordinator = providedCoordinator;

const route = useRoute();
const router = useRouter();
const state = coordinator.state;
const actionPending = ref(false);
const authenticatedLandingReady = ref(false);
const landingNavigationFailed = ref(false);
const landingNavigationPending = ref(false);
const primaryAction = ref<HTMLButtonElement | null>(null);
const errorHeading = ref<HTMLHeadingElement | null>(null);
const landingErrorHeading = ref<HTMLHeadingElement | null>(null);
let landingAttempt = 0;
// Single source for the gate surface colors. Applied via `:style` below; the
// scoped `.mobile-auth-gate` rule intentionally omits `background`/`color` so
// the literals live in one place and the contrast test reads this surface.
const gateSurfaceStyle = {
  backgroundColor: '#f7f7fb',
  color: '#1f2030',
} as const;

const diagnosticBypass = computed(() =>
  shouldBypassMobileAuth(import.meta.env.DEV, route.meta.bypassMobileAuth === true, state),
);
const contentVisible = computed(() => authenticatedLandingReady.value || diagnosticBypass.value);
const progressCopy = computed(() => {
  if (state.phase === 'authenticated' && landingNavigationPending.value) {
    return 'Opening Vela…';
  }
  return PROGRESS_COPY[state.phase] ?? null;
});
const errorPresentation = computed(() =>
  state.errorCode ? ERROR_PRESENTATIONS[state.errorCode] : null,
);

async function showLandingNavigationFailure(attempt: number): Promise<void> {
  if (attempt !== landingAttempt || state.phase !== 'authenticated') {
    return;
  }

  landingNavigationPending.value = false;
  landingNavigationFailed.value = true;
  await nextTick();
  landingErrorHeading.value?.focus();
}

async function attemptLandingNavigation(): Promise<void> {
  if (state.phase !== 'authenticated' || landingNavigationPending.value) {
    return;
  }

  const attempt = ++landingAttempt;
  authenticatedLandingReady.value = false;
  landingNavigationFailed.value = false;
  landingNavigationPending.value = true;

  let result: Awaited<ReturnType<typeof router.replace>>;
  try {
    result = await router.replace('/');
  } catch {
    await showLandingNavigationFailure(attempt);
    return;
  }

  if (attempt !== landingAttempt || state.phase !== 'authenticated') {
    return;
  }

  const duplicatedAtHome =
    isNavigationFailure(result, NavigationFailureType.duplicated) &&
    router.currentRoute.value.fullPath === '/';
  const reachedHomeWithoutFailure =
    !isNavigationFailure(result) && router.currentRoute.value.fullPath === '/';

  landingNavigationPending.value = false;
  if (!duplicatedAtHome && !reachedHomeWithoutFailure) {
    await showLandingNavigationFailure(attempt);
    return;
  }

  landingNavigationFailed.value = false;
  authenticatedLandingReady.value = true;
}

watch(
  () => state.phase,
  async (phase) => {
    if (phase !== 'authenticated') {
      landingAttempt += 1;
      authenticatedLandingReady.value = false;
      landingNavigationFailed.value = false;
      landingNavigationPending.value = false;
      return;
    }

    await attemptLandingNavigation();
  },
  { immediate: true },
);

watch(
  () => state.phase,
  async (phase, previousPhase) => {
    if (
      !previousPhase ||
      !FOCUS_RETURN_PHASES.has(previousPhase) ||
      (phase !== 'signedOut' && phase !== 'error')
    ) {
      return;
    }

    await nextTick();
    if (phase === 'signedOut') {
      primaryAction.value?.focus();
    } else {
      errorHeading.value?.focus();
    }
  },
  { flush: 'post' },
);

async function beginSignIn(): Promise<void> {
  const mayStart =
    state.phase === 'signedOut' ||
    (state.phase === 'error' && errorPresentation.value?.action === 'restart');
  if (!mayStart || actionPending.value) {
    return;
  }

  actionPending.value = true;
  try {
    await coordinator.startSignIn();
  } finally {
    actionPending.value = false;
  }
}

async function retrySessionVerification(): Promise<void> {
  const mayRetry = state.phase === 'error' && errorPresentation.value?.action === 'retrySession';
  if (!mayRetry || actionPending.value) {
    return;
  }

  actionPending.value = true;
  try {
    await coordinator.retrySessionVerification();
  } finally {
    actionPending.value = false;
  }
}
</script>

<template>
  <slot v-if="contentVisible" />

  <main v-else class="mobile-auth-gate" :style="gateSurfaceStyle">
    <section v-if="progressCopy" class="mobile-auth-gate__panel" role="status" aria-live="polite">
      <h1>Vela</h1>
      <p>{{ progressCopy }}</p>
    </section>

    <section
      v-else-if="state.phase === 'authenticated' && landingNavigationFailed"
      class="mobile-auth-gate__panel"
      role="alert"
    >
      <h1 ref="landingErrorHeading" data-testid="landing-error-heading" tabindex="-1">
        {{ LANDING_NAVIGATION_ERROR.heading }}
      </h1>
      <p>{{ LANDING_NAVIGATION_ERROR.message }}</p>
      <button
        ref="primaryAction"
        type="button"
        :disabled="landingNavigationPending"
        @click="attemptLandingNavigation"
      >
        {{ LANDING_NAVIGATION_ERROR.actionLabel }}
      </button>
    </section>

    <section v-else-if="state.phase === 'signedOut'" class="mobile-auth-gate__panel">
      <h1>Vela</h1>
      <p>Continue with Google to open your learning space.</p>
      <button ref="primaryAction" type="button" :disabled="actionPending" @click="beginSignIn">
        Continue with Google
      </button>
    </section>

    <section
      v-else-if="state.phase === 'error' && errorPresentation"
      class="mobile-auth-gate__panel"
      role="alert"
    >
      <h1 ref="errorHeading" data-testid="auth-error-heading" tabindex="-1">
        {{ errorPresentation.heading }}
      </h1>
      <p>{{ errorPresentation.message }}</p>
      <button
        v-if="errorPresentation.action === 'restart'"
        ref="primaryAction"
        type="button"
        :disabled="actionPending"
        @click="beginSignIn"
      >
        {{ errorPresentation.actionLabel }}
      </button>
      <button
        v-else-if="errorPresentation.action === 'retrySession'"
        ref="primaryAction"
        type="button"
        :disabled="actionPending"
        @click="retrySessionVerification"
      >
        {{ errorPresentation.actionLabel }}
      </button>
    </section>
  </main>
</template>

<style scoped>
.mobile-auth-gate {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: max(1.5rem, env(safe-area-inset-top)) max(1.5rem, env(safe-area-inset-right))
    max(1.5rem, env(safe-area-inset-bottom)) max(1.5rem, env(safe-area-inset-left));
}

.mobile-auth-gate__panel {
  width: min(100%, 28rem);
  text-align: center;
}

.mobile-auth-gate__panel h1 {
  margin: 0 0 0.75rem;
}

.mobile-auth-gate__panel p {
  margin: 0 0 1.5rem;
  line-height: 1.5;
}

.mobile-auth-gate__panel button {
  min-height: 44px;
  border: 0;
  border-radius: 0.75rem;
  padding: 0.75rem 1.25rem;
  background: var(--q-primary, #6750a4);
  color: #fff;
  font: inherit;
  font-weight: 600;
}

.mobile-auth-gate__panel button:disabled {
  cursor: wait;
  opacity: 0.65;
}
</style>
