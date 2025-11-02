<template>
  <q-page class="modern-auth-page animated-bg">
    <!-- Floating Decorative Elements -->
    <div class="floating-shapes">
      <div class="shape shape-1"></div>
      <div class="shape shape-2"></div>
      <div class="shape shape-3"></div>
    </div>

    <div class="auth-container">
      <div class="auth-content">
        <!-- App Branding -->
        <div class="brand-section">
          <div class="brand-icon">
            <q-icon name="school" size="3.5rem" color="white" />
          </div>
          <h1 class="brand-title">日本語学習</h1>
          <p class="brand-tagline">Master Japanese with Interactive Learning</p>
        </div>

        <!-- Authentication Card -->
        <div class="auth-card">
          <AuthForm
            :mode="authMode"
            :redirect-to="redirectTo"
            @success="handleAuthSuccess"
            @error="handleAuthError"
          />
        </div>

        <!-- Features Preview -->
        <div class="features-section">
          <div class="feature-pill">
            <q-icon name="quiz" size="1.25rem" />
            <span>Vocabulary Games</span>
          </div>
          <div class="feature-pill">
            <q-icon name="psychology" size="1.25rem" />
            <span>AI-Powered Tutor</span>
          </div>
          <div class="feature-pill">
            <q-icon name="trending_up" size="1.25rem" />
            <span>Track Progress</span>
          </div>
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useAuthStore } from '../../stores/auth';
import AuthForm from '../../components/auth/AuthForm.vue';

// Composables
const route = useRoute();
const router = useRouter();
const $q = useQuasar();
const authStore = useAuthStore();

// State
const authMode = ref<'signin' | 'signup'>('signin');
const redirectTo = ref('/');

// Methods
const handleAuthSuccess = async (type: 'signin' | 'signup') => {
  console.log('Auth success:', type);

  if (type === 'signup') {
    $q.notify({
      type: 'positive',
      message: 'Account created successfully! You can now sign in.',
      timeout: 5000,
    });
    // Navigate to sign-in mode since no verification is needed
    authMode.value = 'signin';
  } else if (type === 'signin') {
    $q.notify({
      type: 'positive',
      message: 'Welcome back!',
      timeout: 3000,
    });
    // Small delay to allow notification to show before redirect
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // Explicitly redirect to desired target (respects ?redirect=...)
    // This ensures navigation even if router guard timing is off
    await router.push(redirectTo.value);
  }
};

const handleAuthError = (message: string) => {
  console.error('Auth error:', message);
  $q.notify({
    type: 'negative',
    message,
    timeout: 5000,
  });
};

onMounted(async () => {
  // Initialize auth store
  await authStore.initialize();

  // Check if user has a valid session (redirect immediately even if profile hasn't loaded)
  if (authStore.session) {
    void router.push(redirectTo.value);
    return;
  }

  // Set auth mode based on route
  if (route.path.includes('signup')) {
    authMode.value = 'signup';
  }

  // Set redirect URL from query params
  if (route.query.redirect && typeof route.query.redirect === 'string') {
    redirectTo.value = route.query.redirect;
  }
});
</script>

<style scoped>
/* Modern Authentication Page */
.modern-auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  padding: 2rem 1rem;
}

/* Floating Background Shapes */
.floating-shapes {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.shape {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.3;
  animation: float 20s ease-in-out infinite;
}

.shape-1 {
  width: 400px;
  height: 400px;
  background: radial-gradient(circle, rgba(255, 107, 107, 0.4), rgba(255, 170, 65, 0.2));
  top: -100px;
  left: -100px;
  animation-delay: 0s;
}

.shape-2 {
  width: 350px;
  height: 350px;
  background: radial-gradient(circle, rgba(94, 114, 228, 0.4), rgba(130, 88, 255, 0.2));
  bottom: -100px;
  right: -100px;
  animation-delay: 5s;
}

.shape-3 {
  width: 300px;
  height: 300px;
  background: radial-gradient(circle, rgba(52, 211, 153, 0.3), rgba(33, 206, 153, 0.2));
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  animation-delay: 10s;
}

@keyframes float {
  0%,
  100% {
    transform: translate(0, 0) scale(1);
  }
  33% {
    transform: translate(30px, -30px) scale(1.1);
  }
  66% {
    transform: translate(-20px, 20px) scale(0.9);
  }
}

/* Main Container */
.auth-container {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 420px;
  animation: fadeInUp 0.6s ease-out;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.auth-content {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

/* Brand Section */
.brand-section {
  text-align: center;
  color: white;
}

.brand-icon {
  margin-bottom: 1rem;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.05);
    opacity: 0.9;
  }
}

.brand-title {
  font-size: 2.75rem;
  font-weight: 700;
  margin: 0 0 0.5rem 0;
  color: white;
  text-shadow: 0 2px 20px rgba(0, 0, 0, 0.3);
  letter-spacing: 2px;
}

.brand-tagline {
  font-size: 1rem;
  font-weight: 400;
  margin: 0;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 1px 10px rgba(0, 0, 0, 0.2);
}

/* Authentication Card */
.auth-card {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 20px;
  padding: 2.5rem;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.5);
  transition: all 0.3s ease;
}

.auth-card:hover {
  box-shadow: 0 25px 70px rgba(0, 0, 0, 0.4);
  transform: translateY(-2px);
}

/* Features Section */
.features-section {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: center;
}

.feature-pill {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  border-radius: 50px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: white;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: default;
  text-shadow: 0 1px 5px rgba(0, 0, 0, 0.2);
}

.feature-pill .q-icon {
  opacity: 0.95;
}

/* Responsive Design */
@media (max-width: 600px) {
  .modern-auth-page {
    padding: 1.5rem 1rem;
  }

  .auth-container {
    max-width: 100%;
  }

  .brand-title {
    font-size: 2.25rem;
  }

  .brand-tagline {
    font-size: 0.9rem;
  }

  .auth-card {
    padding: 2rem 1.5rem;
    border-radius: 16px;
  }

  .feature-pill {
    font-size: 0.8rem;
    padding: 0.625rem 1rem;
  }

  .feature-pill .q-icon {
    font-size: 1.1rem;
  }
}

@media (max-width: 400px) {
  .brand-title {
    font-size: 2rem;
  }

  .auth-card {
    padding: 1.75rem 1.25rem;
  }

  .features-section {
    gap: 0.5rem;
  }

  .feature-pill {
    font-size: 0.75rem;
    padding: 0.5rem 0.875rem;
  }
}
</style>
