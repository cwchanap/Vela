<template>
  <q-page class="modern-auth-page animated-bg">
    <div class="auth-wrapper">
      <!-- Floating Decorative Elements -->
      <div class="floating-shapes">
        <div class="shape shape-1 floating"></div>
        <div class="shape shape-2 floating"></div>
        <div class="shape shape-3 floating"></div>
        <div class="shape shape-4 floating"></div>
      </div>

      <div class="auth-container">
        <!-- Modern App Branding -->
        <div class="modern-branding q-mb-xl">
          <div class="brand-logo floating">
            <q-icon name="school" size="4rem" class="text-white" />
          </div>
          <div class="brand-content">
            <h1 class="brand-title text-white">日本語学習</h1>
            <h2 class="brand-subtitle text-white">Japanese Learning App</h2>
            <p class="brand-description text-white">
              Master Japanese through interactive games and AI assistance
            </p>
          </div>
        </div>

        <!-- Modern Authentication Form -->
        <div class="auth-form-wrapper glass-card">
          <AuthForm
            :mode="authMode"
            :redirect-to="redirectTo"
            @success="handleAuthSuccess"
            @error="handleAuthError"
            class="modern-auth-form"
          />
        </div>

        <!-- Verification Dialog for Cognito Signup -->
        <q-dialog v-model="showVerifyDialog">
          <q-card style="min-width: 380px">
            <q-card-section>
              <div class="text-h6">Verify your email</div>
              <div class="text-subtitle2 q-mt-xs">Enter the 6-digit code sent to your email</div>
            </q-card-section>

            <q-card-section class="q-pt-none">
              <q-input v-model="verifyEmail" label="Email" type="email" outlined class="q-mb-md" />
              <q-input v-model="verifyCode" label="Verification Code" outlined />
            </q-card-section>

            <q-card-actions align="between">
              <q-btn
                flat
                color="primary"
                label="Resend Code"
                :loading="resendLoading"
                :disable="!verifyEmail"
                @click="handleResendCode"
              />
              <div>
                <q-btn flat color="grey-7" label="Cancel" v-close-popup />
                <q-btn
                  unelevated
                  color="primary"
                  label="Confirm"
                  :loading="verifyLoading"
                  :disable="!verifyEmail || !verifyCode"
                  @click="handleConfirmSignUp"
                />
              </div>
            </q-card-actions>
          </q-card>
        </q-dialog>

        <!-- Modern Features Preview -->
        <div class="modern-features-preview glass-card q-mt-xl">
          <div class="features-header q-mb-lg">
            <h3 class="features-title text-white text-center">What you'll learn</h3>
          </div>

          <div class="features-grid">
            <div class="feature-item" data-aos="fade-up" data-aos-delay="100">
              <div class="feature-icon-wrapper vocab-gradient">
                <q-icon name="quiz" size="2rem" class="text-white" />
              </div>
              <div class="feature-content">
                <h4 class="feature-title text-white">Vocabulary Games</h4>
                <p class="feature-description text-white">Interactive flashcards and quizzes</p>
              </div>
            </div>

            <div class="feature-item" data-aos="fade-up" data-aos-delay="200">
              <div class="feature-icon-wrapper ai-gradient">
                <q-icon name="psychology" size="2rem" class="text-white" />
              </div>
              <div class="feature-content">
                <h4 class="feature-title text-white">AI Tutor</h4>
                <p class="feature-description text-white">Personalized learning assistance</p>
              </div>
            </div>

            <div class="feature-item" data-aos="fade-up" data-aos-delay="300">
              <div class="feature-icon-wrapper progress-gradient">
                <q-icon name="trending_up" size="2rem" class="text-white" />
              </div>
              <div class="feature-content">
                <h4 class="feature-title text-white">Progress Tracking</h4>
                <p class="feature-description text-white">Monitor your learning journey</p>
              </div>
            </div>
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
      message: 'Account created! Please verify your email to continue.',
      timeout: 5000,
    });
    // Show verification dialog for Cognito confirmation
    showVerifyDialog.value = true;
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

  // Check if user is already authenticated
  if (authStore.isAuthenticated) {
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

// Verification state and handlers
const showVerifyDialog = ref(false);
const verifyEmail = ref('');
const verifyCode = ref('');
const verifyLoading = ref(false);
const resendLoading = ref(false);

const handleConfirmSignUp = async () => {
  if (!verifyEmail.value || !verifyCode.value) return;
  verifyLoading.value = true;
  try {
    const ok = await authStore.confirmSignUp(verifyEmail.value, verifyCode.value);
    if (ok) {
      $q.notify({ type: 'positive', message: 'Email verified. You can sign in now.' });
      showVerifyDialog.value = false;
      verifyEmail.value = '';
      verifyCode.value = '';
      // Navigate to sign-in mode and redirect
      authMode.value = 'signin';
      await router.push(redirectTo.value);
    } else if (authStore.error) {
      $q.notify({ type: 'negative', message: authStore.error, timeout: 5000 });
    }
  } finally {
    verifyLoading.value = false;
  }
};

const handleResendCode = async () => {
  if (!verifyEmail.value) return;
  resendLoading.value = true;
  try {
    const ok = await authStore.resendSignUpCode(verifyEmail.value);
    if (ok) {
      $q.notify({ type: 'positive', message: 'Verification code resent.' });
    } else if (authStore.error) {
      $q.notify({ type: 'negative', message: authStore.error, timeout: 5000 });
    }
  } finally {
    resendLoading.value = false;
  }
};
</script>

<style scoped>
/* Modern Authentication Page */
.modern-auth-page {
  min-height: 100vh;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  overflow: hidden;
}

.auth-wrapper {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 500px;
}

/* Floating Decorative Shapes */
.floating-shapes {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  pointer-events: none;
}

.shape {
  position: absolute;
  opacity: 0.1;
  border-radius: 50%;
}

.shape-1 {
  width: 200px;
  height: 200px;
  background: var(--gradient-warm);
  top: 10%;
  left: -100px;
  animation-delay: 0s;
}

.shape-2 {
  width: 150px;
  height: 150px;
  background: var(--gradient-cool);
  top: 70%;
  right: -75px;
  animation-delay: 2s;
}

.shape-3 {
  width: 80px;
  height: 80px;
  background: var(--gradient-secondary);
  top: 30%;
  right: 20%;
  animation-delay: 4s;
}

.shape-4 {
  width: 120px;
  height: 120px;
  background: var(--gradient-success);
  bottom: 20%;
  left: 10%;
  animation-delay: 6s;
}

/* Modern Branding */
.modern-branding {
  text-align: center;
  margin-bottom: 3rem;
}

.brand-logo {
  margin-bottom: 1.5rem;
  animation-delay: 0.5s;
}

.brand-title {
  font-size: 3rem;
  font-weight: 800;
  margin: 0 0 0.5rem 0;
  text-shadow: 0 2px 20px rgba(0, 0, 0, 0.3);
  letter-spacing: -1px;
}

.brand-subtitle {
  font-size: 1.5rem;
  font-weight: 300;
  margin: 0 0 1rem 0;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
}

.brand-description {
  font-size: 1.1rem;
  font-weight: 300;
  opacity: 0.9;
  margin: 0;
  text-shadow: 0 1px 5px rgba(0, 0, 0, 0.2);
}

/* Authentication Form Wrapper */
.auth-form-wrapper {
  padding: 2.5rem;
  border: 1px solid var(--glass-border);
  margin-bottom: 2rem;
}

/* Modern Features Preview */
.modern-features-preview {
  padding: 2rem;
  border: 1px solid var(--glass-border);
}

.features-header {
  text-align: center;
}

.features-title {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
}

.features-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border-radius: var(--border-radius-md);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: all 0.3s ease;
}

.feature-item:hover {
  background: rgba(255, 255, 255, 0.1);
  transform: translateY(-2px);
}

.feature-icon-wrapper {
  width: 60px;
  height: 60px;
  border-radius: var(--border-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-soft);
  flex-shrink: 0;
}

.vocab-gradient {
  background: var(--gradient-primary);
}
.ai-gradient {
  background: var(--gradient-success);
}
.progress-gradient {
  background: var(--gradient-warm);
}

.feature-content {
  flex: 1;
}

.feature-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0 0 0.25rem 0;
  text-shadow: 0 1px 5px rgba(0, 0, 0, 0.2);
}

.feature-description {
  font-size: 0.9rem;
  opacity: 0.8;
  margin: 0;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

/* Enhanced Glass Card */
.auth-container .glass-card {
  backdrop-filter: blur(20px);
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

/* Responsive Design */
@media (max-width: 768px) {
  .modern-auth-page {
    padding: 1rem 0.5rem;
  }

  .brand-title {
    font-size: 2.5rem;
  }

  .brand-subtitle {
    font-size: 1.2rem;
  }

  .brand-description {
    font-size: 1rem;
  }

  .auth-form-wrapper {
    padding: 2rem;
  }

  .modern-features-preview {
    padding: 1.5rem;
  }
}

@media (max-width: 480px) {
  .brand-title {
    font-size: 2rem;
  }

  .brand-subtitle {
    font-size: 1rem;
  }

  .brand-description {
    font-size: 0.9rem;
  }

  .auth-form-wrapper {
    padding: 1.5rem;
  }

  .modern-features-preview {
    padding: 1rem;
  }

  .feature-item {
    flex-direction: column;
    text-align: center;
    gap: 0.75rem;
  }

  .feature-icon-wrapper {
    width: 50px;
    height: 50px;
  }
}

/* Additional Animation Enhancement */
.auth-container {
  animation: slideInUp 0.8s ease-out;
}

@keyframes slideInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Enhanced floating animation with different timings */
.floating {
  animation-duration: 4s;
}

.shape-1.floating {
  animation-duration: 8s;
}
.shape-2.floating {
  animation-duration: 6s;
}
.shape-3.floating {
  animation-duration: 10s;
}
.shape-4.floating {
  animation-duration: 7s;
}
</style>
