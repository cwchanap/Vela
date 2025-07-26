<template>
  <q-layout view="lHh Lpr lFf" class="modern-layout">
    <!-- Modern Glassmorphism Header -->
    <q-header class="modern-header glass-header">
      <q-toolbar class="modern-toolbar">
        <q-btn
          flat
          dense
          round
          icon="menu"
          aria-label="Menu"
          @click="toggleLeftDrawer"
          v-if="authStore.isAuthenticated"
          class="glass-button text-white"
        />

        <q-toolbar-title class="flex items-center modern-title">
          <div class="app-logo floating">
            <q-icon name="school" class="q-mr-sm text-h5" />
          </div>
          <span class="gradient-text text-h6">{{ config.app.name }}</span>
        </q-toolbar-title>

        <!-- User menu for authenticated users -->
        <div v-if="authStore.isAuthenticated" class="flex items-center q-gutter-md">
          <!-- User level and XP - Modern Badge -->
          <div class="user-stats glass-card text-white">
            <div class="flex items-center q-gutter-xs">
              <q-icon name="trending_up" size="sm" />
              <span class="text-weight-medium">Lv.{{ authStore.userLevel }}</span>
              <q-separator vertical class="bg-white opacity-50" />
              <q-icon name="stars" size="sm" />
              <span class="text-weight-medium">{{ authStore.userExperience }}XP</span>
            </div>
          </div>

          <!-- Modern User Avatar Dropdown -->
          <q-btn-dropdown flat no-caps class="modern-user-btn glass-button text-white">
            <template v-slot:label>
              <div class="flex items-center q-gutter-sm">
                <q-avatar size="32px" class="modern-avatar">
                  <q-icon name="account_circle" size="32px" />
                </q-avatar>
                <span class="text-weight-medium">{{ authStore.userName }}</span>
              </div>
            </template>

            <q-list class="modern-dropdown glass-card">
              <q-item
                clickable
                v-close-popup
                @click="$router.push('/auth/profile')"
                class="modern-menu-item"
              >
                <q-item-section avatar>
                  <q-icon name="person" color="primary" />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-medium">Profile</q-item-label>
                </q-item-section>
              </q-item>

              <q-item
                clickable
                v-close-popup
                @click="$router.push('/dashboard')"
                class="modern-menu-item"
              >
                <q-item-section avatar>
                  <q-icon name="dashboard" color="secondary" />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-medium">Dashboard</q-item-label>
                </q-item-section>
              </q-item>

              <q-separator class="q-my-sm opacity-30" />

              <q-item clickable v-close-popup @click="handleSignOut" class="modern-menu-item">
                <q-item-section avatar>
                  <q-icon name="logout" color="negative" />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-medium">Sign Out</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
        </div>

        <!-- Modern Sign in button for guests -->
        <div v-else>
          <q-btn
            flat
            no-caps
            label="Sign In"
            @click="$router.push('/auth/login')"
            class="modern-btn glass-button text-white text-weight-medium"
          />
        </div>
      </q-toolbar>
    </q-header>

    <!-- Modern Sidebar with Glassmorphism -->
    <q-drawer
      v-model="leftDrawerOpen"
      show-if-above
      v-if="authStore.isAuthenticated"
      class="modern-drawer"
    >
      <div class="drawer-content">
        <!-- Sidebar Header -->
        <div class="drawer-header glass-card q-pa-md q-mb-md">
          <div class="text-h6 gradient-text text-center">Learning Hub</div>
          <div class="text-caption text-center text-grey-6 q-mt-xs">
            Continue your Japanese journey
          </div>
        </div>

        <!-- Navigation Links -->
        <q-list class="q-px-sm">
          <NavigationLink
            v-for="link in navigationLinks"
            :key="link.title"
            v-bind="link"
            @click="leftDrawerOpen = false"
            class="modern-nav-item"
          />
        </q-list>

        <q-separator class="q-my-lg opacity-30" />

        <!-- Progress Section -->
        <div class="drawer-progress q-px-sm">
          <div class="text-subtitle2 text-weight-bold q-mb-md gradient-text">Your Progress</div>

          <div class="progress-cards q-gutter-sm">
            <div class="progress-card glass-card q-pa-sm">
              <div class="flex items-center q-gutter-sm">
                <q-icon name="trending_up" color="positive" size="md" />
                <div>
                  <div class="text-weight-bold">Level {{ authStore.userLevel }}</div>
                  <div class="text-caption text-grey-6">{{ authStore.userExperience }} XP</div>
                </div>
              </div>
            </div>

            <div class="progress-card glass-card q-pa-sm">
              <div class="flex items-center q-gutter-sm">
                <q-icon name="local_fire_department" color="deep-orange" size="md" />
                <div>
                  <div class="text-weight-bold">{{ authStore.userStreak }} Days</div>
                  <div class="text-caption text-grey-6">Study streak</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </q-drawer>

    <!-- Modern Page Container -->
    <q-page-container class="modern-page-container">
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
/* Modern Layout Styles */
.modern-layout {
  min-height: 100vh;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
}

/* Glassmorphism Header */
.glass-header {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-backdrop);
  border: none;
  box-shadow: var(--shadow-soft);
}

.modern-toolbar {
  min-height: 70px;
  padding: 0 1.5rem;
}

.modern-title {
  font-weight: 700;
  letter-spacing: -0.5px;
}

.app-logo {
  animation-delay: 0.5s;
}

/* User Stats Badge */
.user-stats {
  padding: 0.5rem 1rem;
  border-radius: var(--border-radius-xl);
  font-size: 0.85rem;
}

/* Modern User Button */
.modern-user-btn {
  border-radius: var(--border-radius-md);
  padding: 0.5rem 1rem;
}

.modern-avatar {
  background: var(--gradient-primary);
  box-shadow: var(--shadow-soft);
}

/* Modern Dropdown */
.modern-dropdown {
  min-width: 200px;
  border-radius: var(--border-radius-md);
  border: 1px solid var(--glass-border);
}

.modern-menu-item {
  border-radius: var(--border-radius-sm);
  margin: 0.25rem;
  transition: all 0.2s ease;
}

.modern-menu-item:hover {
  background: rgba(102, 126, 234, 0.1);
  transform: translateX(4px);
}

/* Modern Drawer */
.modern-drawer {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  width: 280px;
}

.drawer-content {
  padding: 1.5rem 1rem;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.drawer-header {
  text-align: center;
  border: 1px solid var(--glass-border);
}

/* Navigation Items */
.modern-nav-item {
  margin-bottom: 0.5rem;
  border-radius: var(--border-radius-md);
  transition: all 0.3s ease;
}

.modern-nav-item:hover {
  background: var(--glass-bg);
  transform: translateX(8px);
}

/* Progress Cards */
.drawer-progress {
  margin-top: auto;
}

.progress-card {
  border: 1px solid var(--glass-border);
  border-radius: var(--border-radius-sm);
  transition: all 0.2s ease;
}

.progress-card:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: scale(1.02);
}

/* Page Container */
.modern-page-container {
  background: transparent;
}

/* Responsive Design */
@media (max-width: 1023px) {
  .modern-drawer {
    width: 260px;
  }

  .modern-toolbar {
    padding: 0 1rem;
  }

  .user-stats {
    display: none;
  }
}

@media (max-width: 600px) {
  .modern-title {
    font-size: 1.1rem;
  }

  .modern-toolbar {
    min-height: 60px;
    padding: 0 0.75rem;
  }

  .modern-user-btn .text-weight-medium {
    display: none;
  }

  .drawer-content {
    padding: 1rem 0.75rem;
  }
}

/* Animation for drawer toggle */
.modern-drawer {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Enhance glassmorphism effect on scroll */
.q-header--hidden {
  transform: translateY(-100%);
}

.q-header {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
</style>
