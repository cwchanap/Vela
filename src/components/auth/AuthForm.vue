<template>
  <q-card class="auth-form" :style="{ minWidth: '400px' }">
    <q-card-section class="text-center">
      <div class="text-h5 q-mb-md">
        {{ isSignUp ? 'Create Account' : 'Welcome Back' }}
      </div>
      <div class="text-subtitle2 text-dark">
        {{ isSignUp ? 'Join us to start learning Japanese' : 'Sign in to continue your journey' }}
      </div>
    </q-card-section>

    <q-card-section>
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

        <!-- Divider -->
        <div class="row items-center q-my-md">
          <div class="col">
            <q-separator />
          </div>
          <div class="col-auto q-px-md text-dark">or</div>
          <div class="col">
            <q-separator />
          </div>
        </div>

        <!-- Magic link button -->
        <q-btn
          :label="`Send Magic Link to ${form.email || 'Email'}`"
          color="secondary"
          outline
          size="lg"
          class="full-width"
          :loading="magicLinkLoading"
          :disable="!form.email || !isValidEmail(form.email) || authStore.isLoading"
          @click="handleMagicLink"
        >
          <template v-slot:default>
            <q-icon name="link" class="q-mr-sm" />
            Send Magic Link
          </template>
        </q-btn>

        <!-- Toggle mode -->
        <div class="text-center q-mt-md">
          <span class="text-dark">
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
    </q-card-section>

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
  </q-card>
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
  redirectTo: '/dashboard',
});

const emit = defineEmits<{
  success: [type: 'signin' | 'signup' | 'magic-link'];
  error: [message: string];
}>();

// Composables
const $q = useQuasar();
const authStore = useAuthStore();

// State
const isSignUp = ref(props.mode === 'signup');
const showPassword = ref(false);
const showForgotPassword = ref(false);
const magicLinkLoading = ref(false);
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
        message: 'Account created successfully! Please check your email to verify your account.',
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

const handleMagicLink = async () => {
  if (!form.email || !isValidEmail(form.email)) {
    return;
  }

  magicLinkLoading.value = true;

  try {
    const success = await authStore.signInWithMagicLink(form.email);

    if (success) {
      $q.notify({
        type: 'positive',
        message: 'Magic link sent! Check your email to sign in.',
        timeout: 5000,
      });
      emit('success', 'magic-link');
    } else if (authStore.error) {
      emit('error', authStore.error);
    }
  } finally {
    magicLinkLoading.value = false;
  }
};

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
  max-width: 450px;
  margin: 0 auto;
}

@media (max-width: 480px) {
  .auth-form {
    margin: 0;
    box-shadow: none;
    border-radius: 0;
  }
}
</style>
