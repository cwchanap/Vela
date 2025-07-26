<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-btn dense flat round icon="menu" @click="toggleLeftDrawer" />
        <q-toolbar-title>
          <q-avatar>
            <img src="https://cdn.quasar.dev/logo-v2/svg/logo-mono-white.svg" />
          </q-avatar>
          Vela
        </q-toolbar-title>

        <q-space />

        <div v-if="user" class="q-gutter-sm row items-center no-wrap">
          <q-btn round dense flat icon="notifications">
            <q-badge color="red" text-color="white" floating> 2 </q-badge>
            <q-tooltip>Notifications</q-tooltip>
          </q-btn>

          <q-btn round flat>
            <q-avatar size="26px">
              <img :src="user.avatar_url || 'https://cdn.quasar.dev/img/boy-avatar.png'" />
            </q-avatar>
            <q-tooltip>Account</q-tooltip>
            <q-menu>
              <q-list style="min-width: 100px">
                <q-item
                  v-for="item in userNavigation"
                  :key="item.name"
                  v-ripple
                  clickable
                  :to="item.path"
                  @click="item.name === 'Logout' && handleLogout()"
                >
                  <q-item-section avatar>
                    <q-icon :name="item.icon" />
                  </q-item-section>
                  <q-item-section>{{ item.name }}</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </div>
      </q-toolbar>
    </q-header>

    <q-drawer v-model="leftDrawerOpen" show-if-above bordered>
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
            <q-item-section>
              <q-item-label>{{ link.name }}</q-item-label>
            </q-item-section>
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
import { ref } from 'vue';
import { useAuthStore } from 'src/stores/auth';
import { storeToRefs } from 'pinia';
import { mainNavigation, userNavigation } from 'src/config/navigation';
import { useRouter } from 'vue-router';

const leftDrawerOpen = ref(false);
const authStore = useAuthStore();
const { user } = storeToRefs(authStore);
const router = useRouter();

const toggleLeftDrawer = () => {
  leftDrawerOpen.value = !leftDrawerOpen.value;
};

const handleLogout = async () => {
  await authStore.signOut();
  void router.push('/login');
};
</script>

<style lang="scss">
.q-page-container {
  background-color: #f0f2f5;
}
</style>
