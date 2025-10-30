<template>
  <div class="auth-form">
    <div class="auth-header text-center q-mb-lg">
      <div class="text-h5 q-mb-sm auth-title">
        {{ isSignUp ? 'Create Account' : 'Welcome Back' }}
      </div>
      <div class="text-subtitle2 auth-subtitle">
        {{ isSignUp ? 'Join us to start learning Japanese' : 'Sign in to continue your journey' }}
      </div>
    </div>

    <q-form @submit="handleSubmit" class="q-gutter-md">
      <!-- Username field (only for sign up) -->
      <q-input
        v-if="isSignUp"
        v-model="form.username"
        label="Username (optional)"
        outlined
        :disable="authStore.isLoading"
        :rules="usernameRules"
      >
        <template v-slot:prepend>
          <q-icon name="person" />
        </template>
      </q-input>

      <!-- Email field -->
      <q-input
        v-model="form.email"
        label="Email"
        type="email"
        outlined
        :disable="authStore.isLoading"
        :rules="emailRules"
        autocomplete="email"
      >
        <template v-slot:prepend>
          <q-icon name="email" />
        </template>
      </q-input>

      <!-- Password field -->
      <q-input
        v-model="form.password"
        :label="isSignUp ? 'Password' : 'Password'"
        :type="showPassword ? 'text' : 'password'"
        outlined
        :disable="authStore.isLoading"
        :rules="passwordRules"
        :autocomplete="isSignUp ? 'new-password' : 'current-password'"
      >
        <template v-slot:prepend>
          <q-icon name="lock" />
        </template>
        <template v-slot:append>
          <q-icon
            :name="showPassword ? 'visibility_off' : 'visibility'"
            class="cursor-pointer"
            @click="showPassword = !showPassword"
          />
        </template>
      </q-input>

      <!-- Error message -->
      <q-banner v-if="authStore.error" class="text-white bg-negative" rounded>
        <template v-slot:avatar>
          <q-icon name="error" />
        </template>
        {{ authStore.error }}
      </q-banner>

      <!-- Submit button -->
      <q-btn
        type="submit"
        :label="isSignUp ? 'Create Account' : 'Sign In'"
        color="primary"
        size="lg"
        class="full-width"
        :loading="authStore.isLoading"
        :disable="!isFormValid"
      />

      <!-- Alternative sign-in (Magic Link) removed: not supported by Cognito -->

      <!-- Toggle mode -->
      <div class="text-center q-mt-md toggle-section">
        <span class="toggle-text">
          {{ isSignUp ? 'Already have an account?' : "Don't have an account?" }}
        </span>
        <q-btn
          flat
          :label="isSignUp ? 'Sign In' : 'Sign Up'"
          color="primary"
          @click="toggleMode"
          :disable="authStore.isLoading"
        />
      </div>

      <!-- Forgot password link (only for sign in) -->
      <div v-if="!isSignUp" class="text-center">
        <q-btn
          flat
          label="Forgot Password?"
          color="grey-6"
          size="sm"
          @click="showForgotPassword = true"
          :disable="authStore.isLoading"
        />
      </div>
    </q-form>

    <!-- Forgot Password Dialog -->
    <q-dialog v-model="showForgotPassword">
      <q-card style="min-width: 350px">
        <q-card-section>
          <div class="text-h6">Reset Password</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input v-model="resetEmail" label="Email" type="email" outlined :rules="emailRules" />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey-6" v-close-popup />
          <q-btn
            flat
            label="Send Reset Link"
            color="primary"
            @click="handlePasswordReset"
            :loading="resetLoading"
            :disable="!resetEmail || !isValidEmail(resetEmail)"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import { useQuasar } from 'quasar';
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
  success: [type: 'signin' | 'signup'];
  error: [message: string];
}>();

// Composables
const $q = useQuasar();
const authStore = useAuthStore();

// State
const isSignUp = ref(props.mode === 'signup');
const showPassword = ref(false);
const showForgotPassword = ref(false);
const resetLoading = ref(false);
const resetEmail = ref('');

const form = reactive({
  email: '',
  password: '',
  username: '',
});

// Computed
const isFormValid = computed(() => {
  return form.email && form.password && isValidEmail(form.email) && form.password.length >= 6;
});

// Validation rules
const emailRules = [
  (val: string) => !!val || 'Email is required',
  (val: string) => isValidEmail(val) || 'Please enter a valid email',
];

const passwordRules = [
  (val: string) => !!val || 'Password is required',
  (val: string) => val.length >= 6 || 'Password must be at least 6 characters',
];

const usernameRules = [
  (val: string) => !val || val.length >= 2 || 'Username must be at least 2 characters',
];

// Methods
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const toggleMode = () => {
  isSignUp.value = !isSignUp.value;
  authStore.setError(null);
};

const handleSubmit = async () => {
  let success = false;

  if (isSignUp.value) {
    success = await authStore.signUp({
      email: form.email,
      password: form.password,
      username: form.username || undefined,
    });

    if (success) {
      $q.notify({
        type: 'positive',
        message: 'Account created successfully! You can now sign in.',
        timeout: 5000,
      });
      emit('success', 'signup');
    }
  } else {
    success = await authStore.signIn({
      email: form.email,
      password: form.password,
    });

    if (success) {
      $q.notify({
        type: 'positive',
        message: 'Welcome back!',
      });
      emit('success', 'signin');
    }
  }

  if (!success && authStore.error) {
    emit('error', authStore.error);
  }
};

// Magic link flow removed; Cognito does not support it

const handlePasswordReset = async () => {
  if (!resetEmail.value || !isValidEmail(resetEmail.value)) {
    return;
  }

  resetLoading.value = true;

  try {
    const success = await authStore.resetPassword(resetEmail.value);

    if (success) {
      $q.notify({
        type: 'positive',
        message: 'Password reset link sent! Check your email.',
        timeout: 5000,
      });
      showForgotPassword.value = false;
      resetEmail.value = '';
    } else if (authStore.error) {
      $q.notify({
        type: 'negative',
        message: authStore.error,
      });
    }
  } finally {
    resetLoading.value = false;
  }
};
</script>

<style scoped>
.auth-form {
  width: 100%;
}

.auth-header {
  margin-bottom: 1.5rem;
}

.auth-title {
  color: #1a1a1a;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.auth-subtitle {
  color: #5a5a5a;
  font-weight: 400;
}

.toggle-section {
  color: #4a4a4a;
  padding-top: 0.5rem;
}

.toggle-text {
  color: #5a5a5a;
  margin-right: 0.5rem;
}

/* Form Container */
:deep(.q-form) {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Input Field Styling */
:deep(.q-field) {
  margin: 0 !important;
}

:deep(.q-field__control) {
  height: 56px !important;
  min-height: 56px !important;
  border-radius: 8px !important;
  background: #f5f5f5 !important;
  border: 2px solid #e0e0e0 !important;
  transition: all 0.3s ease;
  padding: 0 !important;
}

:deep(.q-field__control:hover) {
  border-color: #c0c0c0 !important;
  background: #fafafa !important;
}

:deep(.q-field--focused .q-field__control) {
  border-color: #1976d2 !important;
  background: white !important;
  box-shadow: 0 0 0 3px rgba(25, 118, 210, 0.1) !important;
}

:deep(.q-field__control::before),
:deep(.q-field__control::after) {
  display: none !important;
}

:deep(.q-field__control-container) {
  padding: 0 !important;
}

:deep(.q-field__marginal) {
  height: 56px !important;
}

:deep(.q-field__label) {
  color: #5a5a5a;
  font-size: 0.875rem;
  top: 50%;
  transform: translateY(-50%);
  padding-left: 12px;
}

:deep(.q-field--float .q-field__label) {
  transform: translateY(-135%) scale(0.75);
  padding-left: 0;
}

:deep(.q-field__native) {
  color: #1a1a1a;
  padding: 0 16px;
  height: 56px;
  line-height: 56px;
  font-size: 1rem;
}

:deep(.q-field--with-bottom) {
  padding-bottom: 0;
}

/* Icon Styling */
:deep(.q-field__prepend) {
  padding: 0 0 0 16px;
  height: 56px;
  display: flex;
  align-items: center;
}

:deep(.q-field__append) {
  padding: 0 16px 0 0;
  height: 56px;
  display: flex;
  align-items: center;
}

:deep(.q-icon) {
  color: #7a7a7a;
  font-size: 1.5rem;
}

/* When field has prepend icon, adjust native padding */
:deep(.q-field--with-prepend .q-field__native) {
  padding-left: 0;
}

:deep(.q-field--with-append .q-field__native) {
  padding-right: 0;
}

/* Button Styling */
:deep(.q-btn.full-width) {
  height: 56px !important;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

/* Banner Styling */
:deep(.q-banner) {
  border-radius: 8px;
}

/* Flat buttons alignment */
:deep(.q-btn--flat) {
  min-height: auto;
  padding: 8px 16px;
}

@media (max-width: 480px) {
  .auth-form {
    padding: 0;
  }

  .auth-header {
    margin-bottom: 1rem;
  }

  :deep(.q-field__control) {
    height: 52px !important;
    min-height: 52px !important;
  }

  :deep(.q-field__native) {
    height: 52px;
    line-height: 52px;
  }

  :deep(.q-field__prepend),
  :deep(.q-field__append) {
    height: 52px;
  }

  :deep(.q-btn.full-width) {
    height: 52px !important;
  }
}
</style>
