<template>
  <q-layout view="lHh Lpr lFf">
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-btn
          flat
          dense
          round
          icon="menu"
          aria-label="Menu"
          @click="toggleLeftDrawer"
          v-if="authStore.isAuthenticated"
        />

        <q-toolbar-title class="flex items-center">
          <q-icon name="school" class="q-mr-sm" />
          {{ config.app.name }}
        </q-toolbar-title>

        <!-- User menu for authenticated users -->
        <div v-if="authStore.isAuthenticated" class="flex items-center q-gutter-sm">
          <!-- User level and XP -->
          <div class="text-caption">
            Level {{ authStore.userLevel }} • {{ authStore.userExperience }} XP
          </div>

          <!-- User menu -->
          <q-btn-dropdown flat round icon="account_circle" :label="authStore.userName">
            <q-list>
              <q-item clickable v-close-popup @click="$router.push('/auth/profile')">
                <q-item-section avatar>
                  <q-icon name="person" />
                </q-item-section>
                <q-item-section>Profile</q-item-section>
              </q-item>

              <q-item clickable v-close-popup @click="$router.push('/dashboard')">
                <q-item-section avatar>
                  <q-icon name="dashboard" />
                </q-item-section>
                <q-item-section>Dashboard</q-item-section>
              </q-item>

              <q-separator />

              <q-item clickable v-close-popup @click="handleSignOut">
                <q-item-section avatar>
                  <q-icon name="logout" />
                </q-item-section>
                <q-item-section>Sign Out</q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
        </div>

        <!-- Sign in button for guests -->
        <div v-else>
          <q-btn flat label="Sign In" @click="$router.push('/auth/login')" />
        </div>
      </q-toolbar>
    </q-header>

    <q-drawer
      v-model="leftDrawerOpen"
      show-if-above
      bordered
      v-if="authStore.isAuthenticated"
      class="bg-grey-1"
    >
      <q-list>
        <q-item-label header class="text-primary text-weight-bold"> Learning Hub </q-item-label>

        <NavigationLink
          v-for="link in navigationLinks"
          :key="link.title"
          v-bind="link"
          @click="leftDrawerOpen = false"
        />

        <q-separator class="q-my-md" />

        <q-item-label header class="text-grey-7"> Progress </q-item-label>

        <q-item>
          <q-item-section avatar>
            <q-icon name="trending_up" color="positive" />
          </q-item-section>
          <q-item-section>
            <q-item-label>Level {{ authStore.userLevel }}</q-item-label>
            <q-item-label caption>{{ authStore.userExperience }} XP</q-item-label>
          </q-item-section>
        </q-item>

        <q-item>
          <q-item-section avatar>
            <q-icon name="local_fire_department" color="orange" />
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ authStore.userStreak }} Day Streak</q-item-label>
            <q-item-label caption>Keep it up!</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useAuthStore } from '../stores/auth';
import { config } from '../config';
import NavigationLink from '../components/NavigationLink.vue';

interface NavigationLinkProps {
  title: string;
  caption?: string;
  icon: string;
  to?: string;
  disabled?: boolean;
}

const router = useRouter();
const $q = useQuasar();
const authStore = useAuthStore();

const leftDrawerOpen = ref(false);

const navigationLinks: NavigationLinkProps[] = [
  {
    title: 'Dashboard',
    caption: 'Overview and quick actions',
    icon: 'dashboard',
    to: '/dashboard',
  },
  {
    title: 'Vocabulary Game',
    caption: 'Learn Japanese words',
    icon: 'quiz',
    to: '/games/vocabulary',
    disabled: true, // Will be enabled in future tasks
  },
  {
    title: 'Sentence Game',
    caption: 'Practice grammar',
    icon: 'reorder',
    to: '/games/sentence',
    disabled: true, // Will be enabled in future tasks
  },
  {
    title: 'AI Tutor',
    caption: 'Chat with AI assistant',
    icon: 'psychology',
    to: '/chat',
    disabled: true, // Will be enabled in future tasks
  },
  {
    title: 'Progress',
    caption: 'Track your learning',
    icon: 'analytics',
    to: '/progress',
    disabled: true, // Will be enabled in future tasks
  },
];

function toggleLeftDrawer() {
  leftDrawerOpen.value = !leftDrawerOpen.value;
}

const handleSignOut = async () => {
  const success = await authStore.signOut();

  if (success) {
    $q.notify({
      type: 'positive',
      message: 'Signed out successfully!',
    });
    void router.push('/auth/login');
  } else if (authStore.error) {
    $q.notify({
      type: 'negative',
      message: authStore.error,
    });
  }
};

onMounted(async () => {
  // Initialize auth store
  if (!authStore.isInitialized) {
    await authStore.initialize();
  }
});
</script>

<style scoped>
.q-toolbar {
  min-height: 64px;
}

@media (max-width: 600px) {
  .q-toolbar-title {
    font-size: 1rem;
  }
}
</style>
