<template>
  <q-layout view="hHh LpR fFf">
    <q-header elevated class="bg-primary text-white main-header">
      <q-toolbar>
        <q-btn
          v-if="$q.screen.lt.md"
          dense
          flat
          round
          icon="menu"
          aria-label="Open navigation"
          data-testid="btn-open-nav"
          @click="toggleLeftDrawer"
        />
        <q-btn
          dense
          flat
          round
          :icon="drawerMini ? 'chevron_right' : 'chevron_left'"
          aria-label="Toggle nav collapse"
          data-testid="btn-toggle-nav-collapse"
          @click="toggleMini"
        >
          <q-tooltip>Toggle collapse</q-tooltip>
        </q-btn>
        <q-toolbar-title class="app-title">
          <q-avatar size="32px" class="q-mr-sm">
            <img src="https://cdn.quasar.dev/logo-v2/svg/logo-mono-white.svg" />
          </q-avatar>
          <span class="title-text">Vela</span>
        </q-toolbar-title>

        <q-space />

        <div v-if="user && isInitialized" class="q-gutter-sm row items-center no-wrap">
          <q-btn
            round
            dense
            flat
            :icon="themeStore.isDark ? 'light_mode' : 'dark_mode'"
            data-testid="btn-toggle-theme"
            @click="themeStore.toggle()"
          >
            <q-tooltip>{{ themeStore.isDark ? 'Light mode' : 'Dark mode' }}</q-tooltip>
          </q-btn>

          <q-btn round dense flat icon="notifications">
            <q-badge v-if="notificationCount > 0" color="negative" floating>
              {{ notificationCount }}
            </q-badge>
            <q-tooltip>Notifications</q-tooltip>
          </q-btn>

          <q-btn round flat>
            <q-avatar size="28px">
              <img :src="user.avatar_url || 'https://cdn.quasar.dev/img/boy-avatar.png'" />
            </q-avatar>
            <q-tooltip>Account</q-tooltip>
            <q-menu class="account-menu">
              <q-list dense style="min-width: 140px">
                <q-item
                  v-for="item in userNavigation"
                  :key="item.name"
                  v-ripple
                  clickable
                  dense
                  :to="item.type === 'route' ? item.path : undefined"
                  @click="item.type === 'action' && item.action === 'logout' && handleLogout()"
                >
                  <q-item-section avatar>
                    <q-icon :name="item.icon" size="sm" />
                  </q-item-section>
                  <q-item-section>{{ item.name }}</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </div>
      </q-toolbar>
    </q-header>

    <q-drawer
      v-model="leftDrawerOpen"
      show-if-above
      bordered
      :mini="drawerMini"
      :width="220"
      :mini-width="72"
      behavior="desktop"
      :breakpoint="0"
      class="nav-drawer"
      data-testid="left-drawer"
    >
      <q-scroll-area class="fit">
        <q-list class="nav-list">
          <q-item
            v-for="link in mainNavigation"
            :key="link.name"
            v-ripple
            clickable
            :to="link.path"
            :exact="link.path === '/'"
            class="nav-item"
            :class="{ 'nav-item--active': isActiveRoute(link.path) }"
          >
            <q-item-section avatar>
              <q-icon :name="link.icon" :color="isActiveRoute(link.path) ? 'primary' : undefined" />
            </q-item-section>
            <q-item-section v-if="!drawerMini">
              <q-item-label :class="{ 'text-primary text-weight-bold': isActiveRoute(link.path) }">
                {{ link.name }}
              </q-item-label>
            </q-item-section>
            <q-tooltip v-if="drawerMini" anchor="center right" self="center left">
              {{ link.name }}
            </q-tooltip>
          </q-item>
        </q-list>
      </q-scroll-area>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useAuthStore } from 'src/stores/auth';
import { useThemeStore } from 'src/stores/theme';
import { storeToRefs } from 'pinia';
import { mainNavigation, userNavigation } from 'src/config/navigation';
import { useRouter, useRoute } from 'vue-router';
import { useQuasar } from 'quasar';

const $q = useQuasar();
const leftDrawerOpen = ref(false);
const drawerMini = ref(false);
const notificationCount = ref(0);
const authStore = useAuthStore();
const themeStore = useThemeStore();
const { user, isInitialized } = storeToRefs(authStore);
const router = useRouter();
const route = useRoute();

// Check if route is active (handles nested routes)
const normalizePath = (p: string): string => {
  if (!p) return '/';
  const withLeadingSlash = p.startsWith('/') ? p : `/${p}`;
  if (withLeadingSlash === '/') return '/';
  return withLeadingSlash.replace(/\/+$/, '');
};

const isActiveRoute = (path: string) => {
  const current = normalizePath(route.path);
  const target = normalizePath(path);
  if (target === '/') {
    return current === '/';
  }
  return current === target || current.startsWith(`${target}/`);
};

const toggleLeftDrawer = () => {
  leftDrawerOpen.value = !leftDrawerOpen.value;
};

const toggleMini = () => {
  drawerMini.value = !drawerMini.value;
  // Ensure drawer stays open on desktop when toggling mini state
  if ($q.screen.gt.sm) {
    leftDrawerOpen.value = true;
  }
};

const handleLogout = async () => {
  await authStore.signOut();
  void router.push('/auth/login');
};

// Open drawer by default on desktop, closed on mobile
onMounted(() => {
  leftDrawerOpen.value = $q.screen.gt.sm;
});

watch(
  () => $q.screen.gt.sm,
  (isDesktop) => {
    leftDrawerOpen.value = isDesktop;
  },
);
</script>

<style lang="scss">
// Page container background - uses CSS variables
.q-page-container {
  background-color: var(--bg-page);
}

// Header styling
.main-header {
  .app-title {
    display: flex;
    align-items: center;
  }

  .title-text {
    font-weight: 700;
    font-size: 1.25rem;
    letter-spacing: -0.5px;
  }
}

// Navigation drawer styling
.nav-drawer {
  background: var(--bg-card);
}

.nav-list {
  padding: 12px 8px;
}

.nav-item {
  border-radius: 12px;
  margin-bottom: 4px;
  min-height: 48px;

  &:hover {
    background: rgba(28, 176, 246, 0.08);
  }

  &.nav-item--active {
    background: rgba(28, 176, 246, 0.12);
  }
}

// Account menu styling
.account-menu {
  .q-item {
    min-height: 40px;
    padding: 8px 16px;
  }
}
</style>
