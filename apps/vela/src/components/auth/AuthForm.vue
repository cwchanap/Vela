<template>
  <div class="auth-form">
    <div class="auth-header text-center q-mb-lg">
      <div class="text-h5 q-mb-sm auth-title">Welcome to Vela</div>
      <div class="text-subtitle2 auth-subtitle">
        Continue with Google to start learning Japanese
      </div>
    </div>

    <div class="q-gutter-md">
      <q-banner v-if="authStore.error" class="text-white bg-negative" rounded>
        <template v-slot:avatar>
          <q-icon name="error" />
        </template>
        {{ authStore.error }}
      </q-banner>

      <q-btn
        label="Continue with Google"
        icon="login"
        color="primary"
        size="lg"
        class="full-width"
        :loading="authStore.isLoading"
        :disable="authStore.isLoading"
        @click="handleGoogleSignIn"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from '../../stores/auth';

interface Props {
  mode?: 'signin' | 'signup';
  redirectTo?: string;
}

withDefaults(defineProps<Props>(), {
  mode: 'signin',
  redirectTo: '/',
});

const emit = defineEmits<{
  success: [type: 'signin' | 'signup'];
  error: [message: string];
}>();

const authStore = useAuthStore();

const handleGoogleSignIn = async () => {
  const success = await authStore.signInWithGoogle();

  if (!success && authStore.error) {
    emit('error', authStore.error);
  }
};
</script>

<style scoped>
.auth-form {
  width: 100%;
}

.auth-title {
  color: #1a1a1a;
  font-weight: 700;
}

.auth-subtitle {
  color: #5a5a5a;
  font-weight: 400;
}

:deep(.q-btn.full-width) {
  min-height: 56px;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
}

:deep(.q-banner) {
  border-radius: 8px;
}

@media (max-width: 480px) {
  :deep(.q-btn.full-width) {
    min-height: 52px;
  }
}
</style>
