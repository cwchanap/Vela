<template>
  <q-card flat bordered class="q-pa-md q-mb-lg">
    <div class="text-subtitle1 q-mb-sm">Theme</div>
    <div class="row items-center">
      <div class="col">
        <div class="text-body2">Dark Mode</div>
        <div class="text-caption text-grey">
          {{ themeStore.isDark ? 'Dark theme is enabled' : 'Light theme is enabled' }}
        </div>
      </div>
      <div class="col-auto">
        <q-toggle
          :model-value="darkModeEnabled"
          color="primary"
          data-testid="dark-mode-toggle"
          @update:model-value="toggleDarkMode"
        />
      </div>
    </div>
    <q-separator class="q-my-md" />
    <div class="row items-center q-col-gutter-sm">
      <div class="col-12 col-md-auto">
        <q-btn
          flat
          label="Save to profile"
          color="primary"
          :disable="!isAuthenticated"
          @click="saveThemeToProfile"
        />
      </div>
      <div class="col-12 col-md">
        <div class="text-caption">
          {{
            isAuthenticated
              ? 'Save your theme preference to your profile'
              : 'Sign in to save theme preference'
          }}
        </div>
      </div>
    </div>
  </q-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useThemeStore } from '../../../stores/theme';
import { useAuthStore } from '../../../stores/auth';
import { Notify } from 'quasar';

const themeStore = useThemeStore();
const authStore = useAuthStore();

const isAuthenticated = computed(() => authStore.isAuthenticated);
const darkModeEnabled = computed({
  get: () => themeStore.isDark,
  set: (val: boolean) => {
    themeStore.setDarkMode(val);
  },
});

const toggleDarkMode = () => {
  themeStore.toggle();
};

const saveThemeToProfile = async () => {
  const ok = await themeStore.saveToUserPreferences();
  if (ok) {
    Notify.create({
      type: 'positive',
      message: 'Theme preference saved to your profile',
      position: 'top',
    });
  } else {
    Notify.create({
      type: 'negative',
      message: 'Failed to save theme preference',
      position: 'top',
    });
  }
};
</script>

<style scoped>
/* Improve text contrast in dark mode */
body.body--dark .text-grey,
body.body--dark .text-caption {
  color: #b8b8b8 !important;
}
</style>
