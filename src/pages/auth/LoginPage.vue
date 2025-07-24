<template>
  <q-page class="flex flex-center auth-page">
    <div class="auth-container">
      <!-- App Logo/Title -->
      <div class="text-center q-mb-xl">
        <div class="text-h3 text-primary q-mb-sm">日本語学習</div>
        <div class="text-h5 text-grey-7">Japanese Learning App</div>
        <div class="text-subtitle1 text-grey-6 q-mt-sm">
          Master Japanese through interactive games and AI assistance
        </div>
      </div>

      <!-- Authentication Form -->
      <AuthForm
        :mode="authMode"
        :redirect-to="redirectTo"
        @success="handleAuthSuccess"
        @error="handleAuthError"
      />

      <!-- Features Preview -->
      <div class="features-preview q-mt-xl">
        <div class="text-center text-h6 text-grey-7 q-mb-md">What you'll learn</div>
        <div class="row q-gutter-md justify-center">
          <div class="col-12 col-sm-4 text-center">
            <q-icon name="quiz" size="2rem" color="primary" />
            <div class="text-subtitle2 q-mt-sm">Vocabulary Games</div>
            <div class="text-caption text-grey-6">Interactive flashcards and quizzes</div>
          </div>
          <div class="col-12 col-sm-4 text-center">
            <q-icon name="psychology" size="2rem" color="secondary" />
            <div class="text-subtitle2 q-mt-sm">AI Tutor</div>
            <div class="text-caption text-grey-6">Personalized learning assistance</div>
          </div>
          <div class="col-12 col-sm-4 text-center">
            <q-icon name="trending_up" size="2rem" color="positive" />
            <div class="text-subtitle2 q-mt-sm">Progress Tracking</div>
            <div class="text-caption text-grey-6">Monitor your learning journey</div>
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
const redirectTo = ref('/dashboard');

// Methods
const handleAuthSuccess = (type: 'signin' | 'signup' | 'magic-link') => {
  console.log('Auth success:', type);

  if (type === 'magic-link') {
    $q.notify({
      type: 'info',
      message: 'Check your email for the magic link to complete sign in.',
      timeout: 5000,
    });
  } else if (type === 'signup') {
    $q.notify({
      type: 'info',
      message: 'Please check your email to verify your account before signing in.',
      timeout: 5000,
    });
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
</script>

<style scoped>
.auth-page {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 2rem 1rem;
}

.auth-container {
  width: 100%;
  max-width: 500px;
}

.features-preview {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 1.5rem;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

@media (max-width: 600px) {
  .auth-page {
    padding: 1rem 0.5rem;
  }

  .features-preview {
    margin-top: 2rem;
    padding: 1rem;
  }
}
</style>
