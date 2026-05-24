<script setup lang="ts">
import { ref, onMounted } from 'vue';
import LoginPage from './LoginPage.vue';
import DashboardPage from './DashboardPage.vue';
import { isAuthenticated, clearAuthData, isExplicitSignout } from '../utils/storage';
import { importWebappSession } from '../utils/webappSession';

const authenticated = ref(false);
const loading = ref(true);

onMounted(async () => {
  try {
    authenticated.value = await isAuthenticated();
    if (!authenticated.value) {
      const signedOut = await isExplicitSignout();
      if (!signedOut) {
        authenticated.value = await importWebappSession();
        if (authenticated.value) {
          browser.runtime.sendMessage({ type: 'LOGIN_SUCCESS' }).catch(() => {
            // Background may not be listening during tests or development reloads.
          });
        }
      }
    }
  } catch (error: unknown) {
    console.error('[Vela] Failed to initialise session:', error);
  } finally {
    loading.value = false;
  }
});

function handleLoginSuccess() {
  authenticated.value = true;
  browser.runtime.sendMessage({ type: 'LOGIN_SUCCESS' }).catch(() => {
    // Ignore — background may not be listening (e.g. during development).
  });
}

async function handleSessionExpired() {
  authenticated.value = false;
  try {
    await clearAuthData();
  } catch (error: unknown) {
    console.error('[Vela] Failed to clear auth data on session expiry:', error);
  }
}
</script>

<template>
  <div v-if="loading" class="vela-loading">
    <div class="loading-blob" aria-hidden="true"></div>
    <div class="loading-stack">
      <span class="loading-mark" aria-hidden="true">辞</span>
      <span class="loading-label">Vela</span>
      <span class="loading-bar" aria-hidden="true">
        <span class="loading-bar-fill"></span>
      </span>
    </div>
  </div>
  <LoginPage v-else-if="!authenticated" @login-success="handleLoginSuccess" />
  <DashboardPage v-else @session-expired="handleSessionExpired" />
</template>

<style scoped>
.vela-loading {
  position: relative;
  width: 400px;
  height: 500px;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 50% 40%, rgba(123, 97, 255, 0.22), transparent 60%), var(--bg-page);
  overflow: hidden;
  color: var(--text-primary);
}

.loading-blob {
  position: absolute;
  width: 280px;
  height: 280px;
  border-radius: 50%;
  background: var(--color-primary);
  filter: blur(80px);
  opacity: 0.35;
  animation: vela-blob-drift 10s ease-in-out infinite;
}

.loading-stack {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.loading-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-sakura) 130%);
  color: white;
  font-family: var(--font-jp);
  font-weight: 700;
  font-size: 1.6rem;
  box-shadow: 0 8px 24px rgba(123, 97, 255, 0.45);
  animation: vela-pulse 1.6s ease-in-out infinite;
}

.loading-label {
  font-family: var(--font-display);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.36em;
  text-transform: uppercase;
  color: var(--color-primary-soft);
}

.loading-bar {
  width: 120px;
  height: 3px;
  border-radius: 3px;
  background: rgba(123, 97, 255, 0.16);
  overflow: hidden;
  position: relative;
}

.loading-bar-fill {
  display: block;
  height: 100%;
  width: 40%;
  background: linear-gradient(
    90deg,
    transparent,
    var(--color-primary),
    var(--color-sakura),
    transparent
  );
  border-radius: 3px;
  animation: loading-slide 1.3s ease-in-out infinite;
}

@keyframes loading-slide {
  0% {
    transform: translateX(-150%);
  }
  100% {
    transform: translateX(350%);
  }
}
</style>
