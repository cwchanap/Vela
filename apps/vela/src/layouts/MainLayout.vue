<template>
  <q-layout view="hHh LpR fFf">
    <q-header class="main-header">
      <q-toolbar>
        <q-btn
          v-if="$q.screen.lt.md"
          dense
          flat
          round
          icon="menu"
          aria-label="Open navigation"
          data-testid="btn-open-nav"
          class="header-icon-btn"
          @click="toggleLeftDrawer"
        />
        <q-btn
          dense
          flat
          round
          :icon="drawerMini ? 'chevron_right' : 'chevron_left'"
          aria-label="Toggle nav collapse"
          data-testid="btn-toggle-nav-collapse"
          class="header-icon-btn"
          @click="toggleMini"
        >
          <q-tooltip>Toggle collapse</q-tooltip>
        </q-btn>
        <q-toolbar-title class="app-title">
          <div class="app-logo" aria-label="Vela">
            <span class="logo-mark" aria-hidden="true">帆</span>
            <span class="logo-text">Vela</span>
          </div>
        </q-toolbar-title>

        <q-space />

        <div v-if="user && isInitialized" class="q-gutter-sm row items-center no-wrap">
          <q-btn
            round
            dense
            flat
            :icon="themeStore.isDark ? 'light_mode' : 'dark_mode'"
            data-testid="btn-toggle-theme"
            class="header-icon-btn"
            @click="themeStore.toggle()"
          >
            <q-tooltip>{{ themeStore.isDark ? 'Light mode' : 'Dark mode' }}</q-tooltip>
          </q-btn>

          <q-btn round dense flat icon="notifications" class="header-icon-btn">
            <q-badge v-if="notificationCount > 0" color="negative" floating>
              {{ notificationCount }}
            </q-badge>
            <q-tooltip>Notifications</q-tooltip>
            <q-menu class="notification-menu">
              <q-list dense style="min-width: 220px">
                <q-item v-if="notificationCount === 0">
                  <q-item-section>You're all caught up.</q-item-section>
                </q-item>
                <q-item
                  v-for="item in notificationItems"
                  :key="item.id"
                  clickable
                  v-ripple
                  v-close-popup
                  :to="item.to"
                >
                  <q-item-section avatar>
                    <q-icon :name="item.icon" size="sm" />
                  </q-item-section>
                  <q-item-section>{{ item.label }}</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>

          <q-btn round flat class="avatar-btn">
            <q-avatar size="30px" class="user-avatar">
              <img :src="user.avatar_url || 'https://cdn.quasar.dev/img/boy-avatar.png'" />
            </q-avatar>
            <q-tooltip>Account</q-tooltip>
            <q-menu class="account-menu">
              <q-list dense style="min-width: 160px">
                <q-item
                  v-for="item in userNavigation"
                  :key="item.name"
                  v-ripple
                  clickable
                  dense
                  :to="item.type === 'route' ? item.path : undefined"
                  @click="onUserItemClick(item)"
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
      :width="224"
      :mini-width="68"
      behavior="desktop"
      :breakpoint="0"
      class="nav-drawer"
      data-testid="left-drawer"
    >
      <q-scroll-area class="fit">
        <div class="nav-drawer-inner">
          <!-- Decorative kanji -->
          <span class="nav-kanji-deco" aria-hidden="true">学</span>

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
                <div
                  class="nav-icon-wrap"
                  :class="{ 'nav-icon-wrap--active': isActiveRoute(link.path) }"
                >
                  <q-icon :name="link.icon" size="20px" />
                </div>
              </q-item-section>
              <q-item-section v-if="!drawerMini">
                <q-item-label
                  class="nav-label"
                  :class="{ 'nav-label--active': isActiveRoute(link.path) }"
                >
                  {{ link.name }}
                </q-item-label>
              </q-item-section>
              <q-tooltip v-if="drawerMini" anchor="center right" self="center left">
                {{ link.name }}
              </q-tooltip>
            </q-item>
          </q-list>
        </div>
      </q-scroll-area>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { useAuthStore } from 'src/stores/auth';
import { useThemeStore } from 'src/stores/theme';
import { storeToRefs } from 'pinia';
import { mainNavigation, userNavigation } from 'src/config/navigation';
import { useRouter, useRoute } from 'vue-router';
import { useQuasar } from 'quasar';

const $q = useQuasar();
const leftDrawerOpen = ref(false);
const drawerMini = ref(false);
interface NotificationItem {
  id: string;
  label: string;
  icon: string;
  to?: string;
}

const authStore = useAuthStore();
const themeStore = useThemeStore();
const { user, isInitialized } = storeToRefs(authStore);
const router = useRouter();
const route = useRoute();

const notificationItems = computed<NotificationItem[]>(() => {
  const prefs = user.value?.preferences;
  if (!prefs) return [];

  const items: NotificationItem[] = [];
  const missingPreferences =
    prefs.dailyGoal == null || prefs.dailyLessonGoal == null || prefs.lessonDurationMinutes == null;

  if (missingPreferences) {
    items.push({
      id: 'learning-preferences',
      label: 'Complete your learning preferences',
      icon: 'tune',
      to: '/auth/profile',
    });
  }

  return items;
});

const notificationCount = computed(() => notificationItems.value.length);

const normalizePath = (p: string): string => {
  if (!p) return '/';
  const raw = p.trim();
  if (!raw) return '/';
  let pathname: string;
  try {
    const url = new URL(raw, 'http://example.com');
    pathname = url.pathname;
  } catch {
    pathname = raw.split(/[?#]/)[0] || '/';
  }
  let normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  normalized = normalized.replace(/\/{2,}/g, '/');
  if (normalized === '/') return '/';
  return normalized.replace(/\/+$/, '');
};

const isActiveRoute = (path: string) => {
  const current = normalizePath(route.path);
  const target = normalizePath(path);
  if (target === '/') return current === '/';
  return current === target || current.startsWith(`${target}/`);
};

const toggleLeftDrawer = () => {
  leftDrawerOpen.value = !leftDrawerOpen.value;
};

const toggleMini = () => {
  drawerMini.value = !drawerMini.value;
  if ($q.screen.gt.sm) leftDrawerOpen.value = true;
};

const handleLogout = async () => {
  await authStore.signOut();
  void router.push('/auth/login');
};

const onUserItemClick = (item: (typeof userNavigation)[0]) => {
  if (item.type === 'action' && item.action === 'logout') handleLogout();
};

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
// ============================================
// HEADER
// ============================================
.main-header {
  background: var(--bg-card) !important;
  border-bottom: 1px solid var(--glass-border);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  box-shadow:
    0 1px 0 var(--glass-border),
    var(--shadow-soft) !important;
  color: var(--text-primary) !important;

  .q-toolbar {
    min-height: 60px;
    padding: 0 16px;
  }
}

.header-icon-btn {
  color: var(--text-secondary) !important;
  border-radius: 10px !important;

  &:hover {
    background: var(--nav-item-hover-bg) !important;
    color: var(--color-primary) !important;
  }
}

// ============================================
// LOGO
// ============================================
.app-title {
  display: flex;
  align-items: center;
  padding: 0 8px;
}

.app-logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo-mark {
  font-family: 'Noto Serif JP', serif;
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--color-primary);
  line-height: 1;
  filter: drop-shadow(0 0 8px var(--glow-primary));
}

.logo-text {
  font-family: 'Syne', sans-serif;
  font-weight: 800;
  font-size: 1.2rem;
  letter-spacing: -0.03em;
  color: var(--text-primary);
}

// ============================================
// AVATAR BUTTON
// ============================================
.avatar-btn {
  padding: 4px !important;
  border-radius: 50% !important;
}

.user-avatar {
  border: 2px solid var(--color-primary);
  box-shadow: 0 0 0 2px var(--glow-primary);
}

// ============================================
// NAVIGATION DRAWER
// ============================================
.nav-drawer {
  background: var(--bg-card) !important;
  border-right: 1px solid var(--glass-border) !important;

  .q-drawer__content {
    background: var(--bg-card);
  }
}

.nav-drawer-inner {
  position: relative;
  padding: 8px 0;
  height: 100%;
}

// Decorative kanji behind nav items
.nav-kanji-deco {
  position: absolute;
  bottom: 24px;
  right: 8px;
  font-family: 'Noto Serif JP', serif;
  font-size: 80px;
  font-weight: 700;
  color: var(--color-primary);
  opacity: 0.04;
  line-height: 1;
  pointer-events: none;
  user-select: none;
  z-index: 0;

  body.body--dark & {
    opacity: 0.07;
  }
}

.nav-list {
  padding: 8px 8px;
  position: relative;
  z-index: 1;
}

// ============================================
// NAV ITEMS
// ============================================
.nav-item {
  border-radius: 12px;
  margin-bottom: 2px;
  min-height: 46px;
  position: relative;
  overflow: hidden;

  // Left-side active glow indicator
  &.nav-item--active::after {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 60%;
    background: var(--color-primary);
    border-radius: 0 2px 2px 0;
    box-shadow: 0 0 10px var(--glow-primary);
  }

  &:hover {
    background: var(--nav-item-hover-bg) !important;
  }

  &.nav-item--active {
    background: var(--nav-item-active-bg) !important;
  }

  // Quasar active class override
  &.q-router-link--active {
    background: var(--nav-item-active-bg) !important;
  }
}

// Nav icon wrapper
.nav-icon-wrap {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--text-secondary);
  transition: all 0.2s ease;

  &--active {
    background: var(--glow-primary);
    color: var(--color-primary);
    box-shadow: 0 2px 12px var(--glow-primary);
  }
}

.nav-label {
  font-family: 'Figtree', sans-serif;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 0.01em;

  &--active {
    font-weight: 700;
    color: var(--color-primary);
  }
}

// ============================================
// PAGE CONTAINER
// ============================================
.q-page-container {
  background-color: var(--bg-page);
}

// ============================================
// MENUS
// ============================================
.account-menu,
.notification-menu {
  border-radius: 14px !important;
  border: 1px solid var(--glass-border);
  background: var(--bg-card) !important;
  box-shadow: var(--shadow-medium) !important;
  overflow: hidden;

  .q-item {
    min-height: 42px;
    padding: 8px 16px;
    font-family: 'Figtree', sans-serif;
    font-size: 0.9rem;
    color: var(--text-primary);

    &:hover {
      background: var(--nav-item-hover-bg);
    }
  }
}
</style>
