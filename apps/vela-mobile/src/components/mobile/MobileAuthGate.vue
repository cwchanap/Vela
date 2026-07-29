<script lang="ts">
import type { MobileAuthState } from '../../auth/mobile-auth-contract';

export function shouldBypassMobileAuth(
  isDevelopment: boolean,
  hasBypassMetadata: boolean,
  state: Readonly<MobileAuthState>,
): boolean {
  const ordinarySignedOut =
    state.phase === 'signedOut' &&
    state.operation === 'idle' &&
    state.sessionUsable === false &&
    state.errorCode === null &&
    state.retryAction === null &&
    state.notice === null &&
    state.user === null;

  const bypassableBootError =
    state.phase === 'error' &&
    state.operation === 'idle' &&
    state.sessionUsable === false &&
    (state.errorCode === 'configuration_error' || state.errorCode === 'unsupported_platform') &&
    state.retryAction === null &&
    state.notice === null &&
    state.user === null;

  return (
    isDevelopment &&
    hasBypassMetadata &&
    state.operation === 'idle' &&
    (ordinarySignedOut || bypassableBootError)
  );
}
</script>

<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue';
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter } from 'vue-router';
import type {
  MobileAuthErrorCode,
  MobileAuthOperation,
  MobileAuthPhase,
} from '../../auth/mobile-auth-contract';
import { MOBILE_AUTH_KEY } from '../../services/mobile-auth';
import { selectMobileAuthGateView, type AuthenticatedLandingState } from './mobile-auth-gate-view';

type ErrorAction = 'restart' | null;

type ErrorPresentation = {
  heading: string;
  message: string;
  action: ErrorAction;
  actionLabel?: string;
};

const ERROR_PRESENTATIONS: Partial<Record<MobileAuthErrorCode, ErrorPresentation>> = {
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
    action: null,
  },
};

const SESSION_STATE_FALLBACK: ErrorPresentation = {
  heading: 'Vela cannot use this session',
  message: 'Vela could not safely continue with the current session.',
  action: null,
};

const OAUTH_PROGRESS_COPY: Partial<Record<MobileAuthPhase, string>> = {
  initializing: 'Preparing secure sign-in…',
  openingBrowser: 'Opening Google sign-in…',
  awaitingCallback: 'Waiting for Google sign-in…',
  exchangingCode: 'Completing secure sign-in…',
  verifyingSession: 'Verifying your Vela session…',
};

const OPERATION_COPY: Partial<Record<MobileAuthOperation, string>> = {
  restoring: 'Restoring your Vela session…',
  refreshing: 'Refreshing your Vela session…',
  persisting: 'Securing your Vela session…',
  verifying: 'Verifying your Vela session…',
  signingOut: 'Signing out…',
  cleaningUp: 'Finishing secure sign-out…',
};

const SESSION_UNUSABLE_COPY =
  'Your Vela session is no longer usable. Continue with Google to sign in again.';
const CLEANUP_INCOMPLETE_COPY =
  'Vela could not finish secure sign-out. Your session may return if you close and reopen the app before cleanup succeeds.';

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
const gateSurfaceStyle = {
  backgroundColor: '#f7f7fb',
  color: '#1f2030',
} as const;

const diagnosticBypass = computed(() =>
  shouldBypassMobileAuth(import.meta.env.DEV, route.meta.bypassMobileAuth === true, state),
);
const landingState = computed<AuthenticatedLandingState>(() => {
  if (landingNavigationFailed.value) {
    return 'failed';
  }
  return authenticatedLandingReady.value ? 'ready' : 'pending';
});
const gateView = computed(() => selectMobileAuthGateView(state, landingState.value));
const contentVisible = computed(() => diagnosticBypass.value || gateView.value.kind === 'content');
const progressCopy = computed(() => {
  if (gateView.value.kind !== 'progress') {
    return null;
  }
  if (gateView.value.operation !== 'idle') {
    return OPERATION_COPY[gateView.value.operation] ?? null;
  }
  if (gateView.value.phase === 'authenticated') {
    return 'Opening Vela…';
  }
  return OAUTH_PROGRESS_COPY[gateView.value.phase] ?? null;
});
const activeErrorPresentation = computed(() => {
  if (gateView.value.kind !== 'oauth_error' && gateView.value.kind !== 'blocking_session_failure') {
    return SESSION_STATE_FALLBACK;
  }
  return ERROR_PRESENTATIONS[gateView.value.errorCode] ?? SESSION_STATE_FALLBACK;
});

async function showLandingNavigationFailure(attempt: number): Promise<void> {
  if (attempt !== landingAttempt || state.phase !== 'authenticated' || !state.sessionUsable) {
    return;
  }

  landingNavigationPending.value = false;
  landingNavigationFailed.value = true;
  await nextTick();
  landingErrorHeading.value?.focus();
}

async function attemptLandingNavigation(): Promise<void> {
  if (state.phase !== 'authenticated' || !state.sessionUsable || landingNavigationPending.value) {
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

  if (attempt !== landingAttempt || state.phase !== 'authenticated' || !state.sessionUsable) {
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
  [() => state.phase, () => state.sessionUsable],
  async ([phase, sessionUsable]) => {
    if (phase !== 'authenticated' || !sessionUsable) {
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
  () => gateView.value.kind,
  async (kind, previousKind) => {
    if (previousKind !== 'progress') {
      return;
    }

    await nextTick();
    if (kind === 'signed_out') {
      primaryAction.value?.focus();
      return;
    }
    if (
      kind === 'oauth_error' ||
      kind === 'blocking_session_failure' ||
      kind === 'cleanup_failure' ||
      kind === 'unsupported' ||
      kind === 'invalid_state'
    ) {
      errorHeading.value?.focus();
    }
  },
  { flush: 'post' },
);

watch(
  () => gateView.value.kind,
  (kind, previousKind) => {
    if (kind === 'invalid_state' && previousKind !== 'invalid_state') {
      console.error('mobile_auth_invalid_state');
    }
  },
  { immediate: true },
);

async function beginSignIn(): Promise<void> {
  const mayStart =
    gateView.value.kind === 'signed_out' ||
    (gateView.value.kind === 'oauth_error' && activeErrorPresentation.value.action === 'restart');
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

async function retryCurrentOperation(): Promise<void> {
  const mayRetry =
    gateView.value.kind === 'blocking_session_failure' ||
    gateView.value.kind === 'cleanup_failure' ||
    (gateView.value.kind === 'content' && gateView.value.retry !== null);
  if (!mayRetry || actionPending.value) {
    return;
  }

  actionPending.value = true;
  try {
    await coordinator.retryCurrentOperation();
  } finally {
    actionPending.value = false;
  }
}

async function signOutAndStartOver(): Promise<void> {
  if (gateView.value.kind !== 'blocking_session_failure' || actionPending.value) {
    return;
  }

  actionPending.value = true;
  try {
    await coordinator.signOut();
  } finally {
    actionPending.value = false;
  }
}
</script>

<template>
  <template v-if="contentVisible">
    <slot />
    <section
      v-if="!diagnosticBypass && gateView.kind === 'content' && gateView.retry"
      class="mobile-auth-gate__banner"
      role="alert"
    >
      <h1>
        {{ (ERROR_PRESENTATIONS[gateView.retry.errorCode] ?? SESSION_STATE_FALLBACK).heading }}
      </h1>
      <p>{{ (ERROR_PRESENTATIONS[gateView.retry.errorCode] ?? SESSION_STATE_FALLBACK).message }}</p>
      <button type="button" :disabled="actionPending" @click="retryCurrentOperation">Retry</button>
    </section>
  </template>

  <main v-else class="mobile-auth-gate" :style="gateSurfaceStyle">
    <section
      v-if="gateView.kind === 'progress'"
      class="mobile-auth-gate__panel"
      role="status"
      aria-live="polite"
    >
      <h1>Vela</h1>
      <p>{{ progressCopy }}</p>
    </section>

    <section
      v-else-if="gateView.kind === 'landing_failure'"
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

    <section
      v-else-if="gateView.kind === 'blocking_session_failure'"
      class="mobile-auth-gate__panel"
      role="alert"
    >
      <h1 ref="errorHeading" data-testid="auth-error-heading" tabindex="-1">
        {{ activeErrorPresentation.heading }}
      </h1>
      <p>{{ activeErrorPresentation.message }}</p>
      <button type="button" :disabled="actionPending" @click="retryCurrentOperation">Retry</button>
      <button type="button" :disabled="actionPending" @click="signOutAndStartOver">
        Sign out and start over
      </button>
    </section>

    <section
      v-else-if="gateView.kind === 'signed_out'"
      class="mobile-auth-gate__panel"
      :role="gateView.notice ? 'alert' : undefined"
    >
      <h1>Vela</h1>
      <p v-if="gateView.notice === 'session_unusable'">{{ SESSION_UNUSABLE_COPY }}</p>
      <p v-else>Continue with Google to open your learning space.</p>
      <button ref="primaryAction" type="button" :disabled="actionPending" @click="beginSignIn">
        Continue with Google
      </button>
    </section>

    <section
      v-else-if="gateView.kind === 'cleanup_failure'"
      class="mobile-auth-gate__panel"
      role="alert"
    >
      <h1 ref="errorHeading" data-testid="auth-error-heading" tabindex="-1">
        Vela could not finish secure sign-out
      </h1>
      <p>{{ CLEANUP_INCOMPLETE_COPY }}</p>
      <button type="button" :disabled="actionPending" @click="retryCurrentOperation">Retry</button>
    </section>

    <section
      v-else-if="gateView.kind === 'unsupported'"
      class="mobile-auth-gate__panel"
      role="alert"
    >
      <h1 ref="errorHeading" data-testid="auth-error-heading" tabindex="-1">
        {{ SESSION_STATE_FALLBACK.heading }}
      </h1>
      <p>{{ SESSION_STATE_FALLBACK.message }}</p>
    </section>

    <section
      v-else-if="gateView.kind === 'oauth_error'"
      class="mobile-auth-gate__panel"
      role="alert"
    >
      <h1 ref="errorHeading" data-testid="auth-error-heading" tabindex="-1">
        {{ activeErrorPresentation.heading }}
      </h1>
      <p>{{ activeErrorPresentation.message }}</p>
      <button
        v-if="activeErrorPresentation.action === 'restart'"
        ref="primaryAction"
        type="button"
        :disabled="actionPending"
        @click="beginSignIn"
      >
        {{ activeErrorPresentation.actionLabel }}
      </button>
    </section>

    <section
      v-else-if="gateView.kind === 'invalid_state'"
      class="mobile-auth-gate__panel"
      role="alert"
    >
      <h1 ref="errorHeading" data-testid="auth-error-heading" tabindex="-1">
        {{ SESSION_STATE_FALLBACK.heading }}
      </h1>
      <p>{{ SESSION_STATE_FALLBACK.message }}</p>
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

.mobile-auth-gate__panel,
.mobile-auth-gate__banner {
  width: min(100%, 28rem);
  text-align: center;
}

.mobile-auth-gate__banner {
  margin: 1rem auto;
  padding: 1rem;
}

.mobile-auth-gate__panel h1,
.mobile-auth-gate__banner h1 {
  margin: 0 0 0.75rem;
}

.mobile-auth-gate__panel p,
.mobile-auth-gate__banner p {
  margin: 0 0 1.5rem;
  line-height: 1.5;
}

.mobile-auth-gate__panel button,
.mobile-auth-gate__banner button {
  min-height: 44px;
  border: 0;
  border-radius: 0.75rem;
  margin: 0.25rem;
  padding: 0.75rem 1.25rem;
  background: var(--q-primary, #6750a4);
  color: #fff;
  font: inherit;
  font-weight: 600;
}

.mobile-auth-gate__panel button:disabled,
.mobile-auth-gate__banner button:disabled {
  cursor: wait;
  opacity: 0.65;
}
</style>
