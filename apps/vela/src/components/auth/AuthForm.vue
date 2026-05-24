<template>
  <div class="auth-form">
    <div class="auth-header">
      <span class="auth-kana" aria-hidden="true">ようこそ</span>
      <h2 class="auth-title">Welcome to Vela</h2>
      <p class="auth-subtitle">Continue with Google to start learning Japanese</p>
      <span class="auth-divider" aria-hidden="true"></span>
    </div>

    <div class="auth-body">
      <q-banner v-if="authStore.error" class="auth-error" rounded>
        <template v-slot:avatar>
          <q-icon name="error" />
        </template>
        {{ authStore.error }}
      </q-banner>

      <q-btn
        class="google-cta full-width"
        unelevated
        no-caps
        :loading="authStore.isLoading"
        :disable="authStore.isLoading"
        @click="handleGoogleSignIn"
      >
        <span class="google-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <path
              fill="#FFC107"
              d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
            />
            <path
              fill="#FF3D00"
              d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z"
            />
            <path
              fill="#4CAF50"
              d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
            />
            <path
              fill="#1976D2"
              d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
            />
          </svg>
        </span>
        <span class="google-label">Continue with Google</span>
        <span class="google-arrow" aria-hidden="true">→</span>
      </q-btn>

      <p class="auth-fine">
        <q-icon name="lock" size="0.9rem" />
        <span>Secured by Cognito &middot; Your data stays yours</span>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from '../../stores/auth';

interface Props {
  mode?: 'signin' | 'signup';
  redirectTo?: string;
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'signin',
  redirectTo: '/',
});

const emit = defineEmits<{
  error: [message: string];
}>();

const authStore = useAuthStore();

const handleGoogleSignIn = async () => {
  const success = await authStore.signInWithGoogle(props.redirectTo);

  if (!success && authStore.error) {
    emit('error', authStore.error);
  }
};
</script>

<style scoped lang="scss">
.auth-form {
  width: 100%;
  position: relative;
  z-index: 1;
}

.auth-header {
  text-align: center;
  margin-bottom: 1.5rem;
  position: relative;
}

.auth-kana {
  display: inline-block;
  font-family: 'Noto Serif JP', serif;
  font-size: 0.78rem;
  font-weight: 300;
  letter-spacing: 0.5em;
  color: var(--color-primary);
  opacity: 0.7;
  margin-bottom: 0.45rem;
  padding-left: 0.5em;
}

.auth-title {
  font-family: Syne, sans-serif;
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--text-primary);
  margin: 0 0 0.35rem;
  line-height: 1.15;
}

.auth-subtitle {
  font-family: Figtree, sans-serif;
  font-size: 0.9rem;
  font-weight: 400;
  line-height: 1.45;
  color: var(--text-secondary);
  margin: 0 auto;
  max-width: 32ch;
}

.auth-divider {
  display: block;
  width: 60px;
  height: 2px;
  margin: 1.1rem auto 0;
  background: linear-gradient(90deg, transparent, var(--color-primary), transparent);
  opacity: 0.5;
  border-radius: 2px;
}

.auth-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Error banner */
.auth-error {
  border-radius: var(--border-radius-md);
  background: rgba(240, 75, 90, 0.08) !important;
  color: var(--color-error) !important;
  border: 1px solid rgba(240, 75, 90, 0.25);
  font-family: Figtree, sans-serif;
  font-size: 0.85rem;
}

body.body--dark .auth-error {
  background: rgba(255, 84, 112, 0.12) !important;
}

/* Google CTA */
:deep(.google-cta) {
  position: relative;
  min-height: 58px;
  border-radius: var(--border-radius-md);
  background: linear-gradient(
    135deg,
    var(--color-primary) 0%,
    #6f5cff 50%,
    var(--color-sakura) 130%
  );
  color: white;
  font-family: Syne, sans-serif;
  font-size: 0.98rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-transform: none;
  box-shadow:
    0 8px 24px rgba(91, 74, 247, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
  overflow: hidden;
  transition:
    transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.3s ease;
}

:deep(.google-cta::before) {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    transparent 30%,
    rgba(255, 255, 255, 0.18) 50%,
    transparent 70%
  );
  transform: translateX(-100%);
  transition: transform 0.7s ease;
}

:deep(.google-cta:hover) {
  transform: translateY(-2px);
  box-shadow:
    0 14px 36px rgba(91, 74, 247, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

:deep(.google-cta:hover::before) {
  transform: translateX(100%);
}

:deep(.google-cta .q-btn__content) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.7rem;
  width: 100%;
}

.google-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: white;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
}

.google-label {
  font-family: Syne, sans-serif;
  font-size: 1rem;
  font-weight: 600;
}

.google-arrow {
  margin-left: 0.15rem;
  font-size: 1.1rem;
  opacity: 0.85;
  transition: transform 0.25s ease;
}

:deep(.google-cta:hover) .google-arrow {
  transform: translateX(4px);
}

/* Fine print */
.auth-fine {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  margin: 0.5rem 0 0;
  font-family: Figtree, sans-serif;
  font-size: 0.75rem;
  color: var(--text-secondary);
  opacity: 0.75;
}

.auth-fine .q-icon {
  color: var(--color-primary);
  opacity: 0.7;
}

/* Full width helper for legacy class consumers */
.full-width {
  width: 100%;
}

@media (max-width: 480px) {
  :deep(.google-cta) {
    min-height: 54px;
    font-size: 0.92rem;
  }
  .auth-title {
    font-size: 1.4rem;
  }
}
</style>
