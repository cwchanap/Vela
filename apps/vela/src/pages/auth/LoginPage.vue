<template>
  <q-page class="login-page">
    <!-- Ambient indigo / sakura / jade blobs -->
    <div class="ambient-layer" aria-hidden="true">
      <div class="ambient-blob blob-primary"></div>
      <div class="ambient-blob blob-sakura"></div>
      <div class="ambient-blob blob-jade"></div>
    </div>

    <!-- Decorative kanji watermark -->
    <div class="kanji-deco kanji-watermark" aria-hidden="true">学</div>

    <!-- Hairline grid background -->
    <div class="grid-overlay" aria-hidden="true"></div>

    <div class="auth-container">
      <!-- Brand: eyebrow + stacked Japanese wordmark + tagline -->
      <header class="brand anim-enter-1">
        <span class="brand-eyebrow">
          <span class="brand-dot"></span>
          Vela &middot; ヴェラ
        </span>
        <h1 class="brand-title">日本語学習</h1>
        <p class="brand-tagline">Master Japanese with Interactive Learning</p>
      </header>

      <!-- Glass-card sign-in -->
      <section class="auth-card anim-enter-2">
        <div class="auth-card-glow" aria-hidden="true"></div>
        <AuthForm :mode="authMode" :redirect-to="redirectTo" @error="handleAuthError" />
      </section>

      <!-- Feature pills -->
      <ul class="feature-rail anim-enter-3">
        <li class="feature-pill pill-vocab">
          <span class="pill-icon">
            <q-icon name="quiz" size="1.1rem" />
          </span>
          <span class="pill-label">Vocabulary Games</span>
        </li>
        <li class="feature-pill pill-chat">
          <span class="pill-icon">
            <q-icon name="psychology" size="1.1rem" />
          </span>
          <span class="pill-label">AI-Powered Tutor</span>
        </li>
        <li class="feature-pill pill-streak">
          <span class="pill-icon">
            <q-icon name="trending_up" size="1.1rem" />
          </span>
          <span class="pill-label">Track Progress</span>
        </li>
      </ul>

      <p class="auth-footnote anim-enter-4">Continue with Google &middot; No password required</p>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useAuthStore } from '../../stores/auth';
import AuthForm from '../../components/auth/AuthForm.vue';

const route = useRoute();
const router = useRouter();
const $q = useQuasar();
const authStore = useAuthStore();

const authMode = ref<'signin' | 'signup'>('signin');
const redirectTo = ref('/');

const getRouteRedirect = () => authStore.getSafeAuthRedirect(route.query.redirect);

const getInitialRedirect = () => {
  const routeRedirect = getRouteRedirect();
  const isAuthCallback = route.name === 'auth-callback' || route.path === '/auth/callback';
  return isAuthCallback ? authStore.consumePendingAuthRedirect(routeRedirect) : routeRedirect;
};

let navigated = false;

const unwatchAuth = watch(
  () => authStore.isAuthenticated,
  (authenticated) => {
    if (authenticated && !navigated) {
      navigated = true;
      unwatchAuth();
      void router.push(redirectTo.value);
    }
  },
);

const handleAuthError = (message: string) => {
  console.error('Auth error:', message);
  $q.notify({
    type: 'negative',
    message,
    timeout: 5000,
  });
};

onMounted(async () => {
  redirectTo.value = getInitialRedirect();

  await authStore.initialize();

  if (authStore.isAuthenticated && !navigated) {
    navigated = true;
    unwatchAuth();
    void router.push(redirectTo.value);
    return;
  }
});
</script>

<style scoped lang="scss">
/* ============================================
   Vela Auth — wa-modern ink + indigo bloom
   ============================================ */
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  padding: clamp(1.5rem, 4vw, 3rem) 1rem;
  background:
    radial-gradient(circle at 12% 18%, rgba(91, 74, 247, 0.18), transparent 55%),
    radial-gradient(circle at 88% 82%, rgba(232, 68, 122, 0.16), transparent 55%), var(--bg-page);
}

body.body--dark .login-page {
  background:
    radial-gradient(circle at 12% 18%, rgba(123, 97, 255, 0.28), transparent 55%),
    radial-gradient(circle at 88% 82%, rgba(255, 107, 163, 0.18), transparent 55%), var(--bg-page);
}

/* Hairline graph grid */
.grid-overlay {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(91, 74, 247, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(91, 74, 247, 0.05) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(circle at center, black 30%, transparent 75%);
  -webkit-mask-image: radial-gradient(circle at center, black 30%, transparent 75%);
}

body.body--dark .grid-overlay {
  background-image:
    linear-gradient(rgba(123, 97, 255, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(123, 97, 255, 0.08) 1px, transparent 1px);
}

/* Watermark kanji */
.kanji-watermark {
  font-size: clamp(22rem, 55vw, 42rem);
  top: 50%;
  left: 50%;
  transform: translate(-50%, -52%);
  z-index: 0;
  opacity: 0.045;
  letter-spacing: -0.05em;
}

body.body--dark .kanji-watermark {
  opacity: 0.07;
}

/* Container */
.auth-container {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 460px;
  display: flex;
  flex-direction: column;
  gap: clamp(1.5rem, 3vw, 2.25rem);
}

/* Brand */
.brand {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.brand-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  font-family: Syne, sans-serif;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--color-primary);
  padding: 0.45rem 0.95rem;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-subtle);
  backdrop-filter: blur(8px);
}

.brand-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-primary);
  box-shadow: 0 0 0 4px rgba(91, 74, 247, 0.15);
  animation: glow-pulse 2.4s ease-in-out infinite;
}

.brand-title {
  font-family: 'Noto Serif JP', serif;
  font-weight: 700;
  font-size: clamp(2.8rem, 7vw, 4rem);
  letter-spacing: 0.02em;
  margin: 0.3rem 0 0.15rem;
  line-height: 1;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-sakura) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.brand-tagline {
  font-family: Figtree, sans-serif;
  font-size: 0.95rem;
  font-weight: 400;
  letter-spacing: 0.01em;
  color: var(--text-secondary);
  margin: 0;
  max-width: 28ch;
}

/* Card */
.auth-card {
  position: relative;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-backdrop);
  -webkit-backdrop-filter: var(--glass-backdrop);
  border: 1px solid var(--glass-border);
  border-radius: var(--border-radius-xl);
  padding: clamp(1.75rem, 4vw, 2.25rem) clamp(1.5rem, 4vw, 2.25rem) clamp(1.5rem, 3vw, 2rem);
  box-shadow: var(--shadow-medium);
  overflow: hidden;
}

/* Subtle indigo halo behind card */
.auth-card-glow {
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(
    135deg,
    rgba(91, 74, 247, 0.4),
    transparent 35%,
    transparent 65%,
    rgba(232, 68, 122, 0.3)
  );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  pointer-events: none;
}

/* Feature rail */
.feature-rail {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  padding: 0;
  margin: 0;
}

.feature-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.95rem;
  border-radius: 999px;
  background: var(--glass-bg-subtle);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(8px);
  font-family: Syne, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-primary);
  cursor: default;
  transition:
    transform 0.25s ease,
    border-color 0.25s ease,
    color 0.25s ease;
}

.feature-pill:hover {
  transform: translateY(-2px);
}

.pill-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 0.7rem;
}

.pill-vocab .pill-icon {
  background: rgba(91, 74, 247, 0.12);
  color: var(--color-primary);
}
.pill-vocab:hover {
  border-color: rgba(91, 74, 247, 0.3);
}

.pill-chat .pill-icon {
  background: rgba(29, 184, 122, 0.12);
  color: var(--color-success);
}
.pill-chat:hover {
  border-color: rgba(29, 184, 122, 0.3);
}

.pill-streak .pill-icon {
  background: rgba(232, 68, 122, 0.12);
  color: var(--color-sakura);
}
.pill-streak:hover {
  border-color: rgba(232, 68, 122, 0.3);
}

.pill-label {
  line-height: 1;
}

/* Footnote */
.auth-footnote {
  text-align: center;
  margin: 0;
  font-family: Figtree, sans-serif;
  font-size: 0.78rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  opacity: 0.85;
}

/* Responsive */
@media (max-width: 600px) {
  .auth-container {
    max-width: 100%;
    gap: 1.25rem;
  }
  .brand-eyebrow {
    font-size: 0.65rem;
    letter-spacing: 0.28em;
  }
  .feature-pill {
    font-size: 0.7rem;
    padding: 0.45rem 0.75rem;
  }
}

@media (max-width: 400px) {
  .auth-card {
    border-radius: var(--border-radius-lg);
  }
  .feature-rail {
    gap: 0.4rem;
  }
}
</style>
