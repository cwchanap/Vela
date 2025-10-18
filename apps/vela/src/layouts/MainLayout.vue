<template>
  <q-layout view="hHh LpR fFf">
    <q-header elevated :class="['bg-primary', isDashboard ? 'text-black' : 'text-white']">
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
        <q-toolbar-title>
          <q-avatar>
            <img src="https://cdn.quasar.dev/logo-v2/svg/logo-mono-white.svg" />
          </q-avatar>
          Vela
        </q-toolbar-title>

        <q-space />

        <div v-if="user && isInitialized" class="q-gutter-sm row items-center no-wrap">
          <q-btn
            round
            dense
            flat
            :icon="themeStore.isDark ? 'light_mode' : 'dark_mode'"
            :color="headerIconColor"
            data-testid="btn-toggle-theme"
            @click="themeStore.toggle()"
          >
            <q-tooltip>{{ themeStore.isDark ? 'Light mode' : 'Dark mode' }}</q-tooltip>
          </q-btn>

          <q-btn round dense flat icon="notifications" :color="headerIconColor">
            <q-badge color="red" :text-color="badgeTextColor" floating> 2 </q-badge>
            <q-tooltip>Notifications</q-tooltip>
          </q-btn>

          <q-btn round flat :color="headerIconColor">
            <q-avatar size="26px">
              <img :src="user.avatar_url || 'https://cdn.quasar.dev/img/boy-avatar.png'" />
            </q-avatar>
            <q-tooltip>Account</q-tooltip>
            <q-menu class="account-menu" content-class="account-menu__content">
              <q-list dense style="min-width: 100px" class="q-px-none q-py-xs">
                <q-item
                  v-for="item in userNavigation"
                  :key="item.name"
                  v-ripple
                  clickable
                  dense
                  class="q-px-none q-py-xs"
                  :to="item.path"
                  @click="item.name === 'Logout' && handleLogout()"
                >
                  <q-item-section class="q-pl-none">
                    <span>{{ item.name }}</span>
                  </q-item-section>
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
      :width="240"
      :mini-width="64"
      behavior="desktop"
      :breakpoint="0"
      data-testid="left-drawer"
    >
      <q-scroll-area class="fit">
        <q-list>
          <q-item-label header>Navigation</q-item-label>
          <q-item
            v-for="link in mainNavigation"
            :key="link.name"
            v-ripple
            clickable
            :to="link.path"
          >
            <q-item-section avatar>
              <q-icon :name="link.icon" />
            </q-item-section>
            <q-item-section v-if="!drawerMini">
              <q-item-label>{{ link.name }}</q-item-label>
            </q-item-section>
            <q-tooltip v-if="drawerMini">{{ link.name }}</q-tooltip>
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
const authStore = useAuthStore();
const themeStore = useThemeStore();
const { user, isInitialized } = storeToRefs(authStore);
const router = useRouter();
const route = useRoute();

const isDashboard = computed(() => route.name === 'home');

// Header colors that respect both dashboard state and dark mode
const headerIconColor = computed(() => {
  // In dark mode, always use white/no specific color (uses default white from Quasar)
  if (themeStore.isDark) return undefined;
  // In light mode dashboard, use black
  return isDashboard.value ? 'black' : undefined;
});

const badgeTextColor = computed(() => {
  // In dark mode, always use white
  if (themeStore.isDark) return 'white';
  // In light mode dashboard, use black
  return isDashboard.value ? 'black' : 'white';
});

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
// Page container background - respects dark mode
.q-page-container {
  background-color: #f0f2f5;
}

body.body--dark .q-page-container {
  background-color: #121212;
}

/* Force header content to black on dashboard (when we apply text-black dynamically) */
.q-header.text-black,
.q-header.text-black * {
  color: #000 !important;
  fill: #000 !important;
}

/* In dark mode, override the forced black text on dashboard header */
body.body--dark .q-header.text-black,
body.body--dark .q-header.text-black * {
  color: #fff !important;
  fill: #fff !important;
}

/* Compact spacing for user avatar dropdown */
.account-menu .q-item {
  min-height: 34px;
  padding-left: 0 !important;
  padding-right: 8px;
  text-align: center;
}
.account-menu .q-item .q-item__section:first-child {
  padding-left: 0 !important;
  margin-left: 0 !important;
}
.account-menu .q-item .q-item__section--main {
  padding-left: 0 !important;
  margin-left: 0 !important;
  justify-content: center;
}
.account-menu .q-item .q-item__section--main .row {
  gap: 0 !important;
}
.account-menu .q-list {
  padding-top: 4px;
  padding-bottom: 4px;
  padding-left: 0 !important;
  padding-right: 0 !important;
}
/* Remove any container padding from the q-menu content */
.account-menu__content {
  padding: 0 !important;
}
</style>
