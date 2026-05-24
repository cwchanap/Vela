<template>
  <div class="vela-popup login">
    <div class="ambient" aria-hidden="true">
      <div class="blob blob-a"></div>
      <div class="blob blob-b"></div>
    </div>
    <div class="kanji-mark" aria-hidden="true">辞典</div>

    <header class="brand">
      <span class="brand-eyebrow">
        <span class="brand-dot"></span>
        Vela &middot; ヴェラ
      </span>
      <h1 class="brand-title">辞書拡張</h1>
      <p class="brand-tagline">Save Japanese sentences to your dictionary</p>
    </header>

    <section class="card">
      <div class="card-row">
        <span class="card-label">Step 1</span>
        <p class="card-copy">Sign in to the Vela web app, then return to this popup.</p>
      </div>

      <a class="login-url" :href="loginUrl" @click.prevent="handleOpenWebappLogin">
        <span class="url-icon">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M10 14L21 3M21 3H15M21 3V9M21 13V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V5C3 3.9 3.9 3 5 3H11"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <span class="url-text">{{ loginUrl }}</span>
      </a>

      <div v-if="error" class="error-banner">
        <span class="error-dot"></span>
        {{ error }}
      </div>

      <div class="actions">
        <button
          type="button"
          class="btn btn-primary"
          :disabled="webSessionLoading"
          @click="handleOpenWebappLogin"
        >
          <span class="btn-label">Open Vela Login</span>
          <span class="btn-arrow">→</span>
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="webSessionLoading"
          @click="handleUseWebappSession"
        >
          <span v-if="webSessionLoading" class="spinner" aria-hidden="true"></span>
          {{ webSessionLoading ? 'Checking…' : 'Refresh Session' }}
        </button>
      </div>
    </section>

    <p class="footnote">Secure session import &middot; No password stored</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { getWebappLoginUrl, importWebappSession, openWebappLogin } from '../utils/webappSession';
import { clearExplicitSignout } from '../utils/storage';

const emit = defineEmits<{
  loginSuccess: [];
}>();

const webSessionLoading = ref(false);
const error = ref('');
const loginUrl = getWebappLoginUrl();

async function handleOpenWebappLogin() {
  error.value = '';
  try {
    await openWebappLogin();
  } catch (err) {
    console.error('[Vela] Failed to open webapp login:', err);
    error.value = err instanceof Error ? err.message : 'Failed to open login page';
  }
}

async function handleUseWebappSession() {
  webSessionLoading.value = true;
  error.value = '';

  try {
    const imported = await importWebappSession();
    if (imported) {
      await clearExplicitSignout();
      emit('loginSuccess');
      return;
    }

    error.value = 'Sign in at the URL above, then return here and refresh the session.';
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to import web app session';
  } finally {
    webSessionLoading.value = false;
  }
}
</script>

<style scoped>
.vela-popup.login {
  position: relative;
  width: 400px;
  min-height: 500px;
  display: flex;
  flex-direction: column;
  padding: 24px 22px 20px;
  gap: 22px;
  background:
    radial-gradient(circle at 15% 8%, rgba(123, 97, 255, 0.16), transparent 55%),
    radial-gradient(circle at 92% 92%, rgba(255, 107, 163, 0.1), transparent 55%), var(--bg-page);
  overflow: hidden;
}

/* Ambient blobs */
.ambient {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}

.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.32;
  will-change: transform;
}

.blob-a {
  width: 260px;
  height: 260px;
  background: var(--color-primary);
  top: -80px;
  right: -60px;
  animation: vela-blob-drift 14s ease-in-out infinite;
}

.blob-b {
  width: 200px;
  height: 200px;
  background: var(--color-sakura);
  bottom: -60px;
  left: -40px;
  animation: vela-blob-drift 18s ease-in-out infinite reverse;
}

/* Background kanji mark */
.kanji-mark {
  position: absolute;
  top: 45%;
  right: -30px;
  font-family: var(--font-jp);
  font-weight: 700;
  font-size: 14rem;
  color: var(--color-primary);
  opacity: 0.05;
  line-height: 0.8;
  letter-spacing: -0.04em;
  z-index: 0;
  pointer-events: none;
  user-select: none;
}

/* Brand */
.brand {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
  animation: vela-fade-up 0.5s ease-out both;
}

.brand-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-subtle);
  font-family: var(--font-display);
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--color-primary-soft);
}

.brand-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-primary-soft);
  box-shadow: 0 0 0 3px rgba(123, 97, 255, 0.18);
  animation: vela-pulse 2.2s ease-in-out infinite;
}

.brand-title {
  font-family: var(--font-jp);
  font-weight: 700;
  font-size: 2rem;
  margin: 6px 0 2px;
  line-height: 1;
  letter-spacing: 0.04em;
  background: linear-gradient(135deg, #b89aff, #ff6ba3);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.brand-tagline {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 400;
  letter-spacing: 0.01em;
  color: var(--text-secondary);
}

/* Card */
.card {
  position: relative;
  z-index: 1;
  background: var(--glass-bg);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 18px;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: vela-fade-up 0.55s ease-out 0.08s both;
}

.card-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card-label {
  font-family: var(--font-display);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--color-primary-soft);
}

.card-copy {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.45;
  color: var(--text-secondary);
}

/* URL chip */
.login-url {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.76rem;
  line-height: 1.3;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  word-break: break-all;
  transition:
    border-color 0.2s ease,
    background 0.2s ease;
}

.login-url:hover {
  border-color: var(--border-strong);
  background: var(--bg-elevated);
  color: var(--color-primary-soft);
}

.url-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: rgba(123, 97, 255, 0.15);
  color: var(--color-primary-soft);
}

.url-text {
  flex: 1;
}

/* Error banner */
.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(255, 84, 112, 0.1);
  border: 1px solid rgba(255, 84, 112, 0.3);
  border-radius: var(--radius-md);
  color: var(--color-error);
  font-size: 0.82rem;
  line-height: 1.4;
}

.error-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-error);
  box-shadow: 0 0 0 3px rgba(255, 84, 112, 0.15);
}

/* Actions */
.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 18px;
  border-radius: var(--radius-md);
  font-family: var(--font-display);
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  border: none;
  cursor: pointer;
  transition:
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.25s ease,
    background 0.25s ease,
    color 0.2s ease;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-primary {
  background: linear-gradient(
    135deg,
    var(--color-primary) 0%,
    #9b7bff 50%,
    var(--color-sakura) 130%
  );
  color: white;
  box-shadow:
    var(--shadow-button),
    inset 0 1px 0 rgba(255, 255, 255, 0.14);
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow:
    0 10px 28px rgba(123, 97, 255, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.btn-primary:hover:not(:disabled) .btn-arrow {
  transform: translateX(3px);
}

.btn-arrow {
  font-size: 1rem;
  transition: transform 0.2s ease;
}

.btn-ghost {
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--bg-elevated);
  border-color: var(--border-strong);
  color: var(--color-primary-soft);
}

.spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(123, 97, 255, 0.25);
  border-top-color: var(--color-primary-soft);
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Footnote */
.footnote {
  position: relative;
  z-index: 1;
  margin: auto 0 0;
  text-align: center;
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
  opacity: 0.8;
  animation: vela-fade-up 0.6s ease-out 0.16s both;
}
</style>
