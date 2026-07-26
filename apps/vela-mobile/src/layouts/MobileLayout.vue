<template>
  <q-layout view="hHh lpR fFf">
    <MobilePageHeader />

    <q-page-container
      :class="{
        'mobile-page-container--headerless': !hasMobileHeader,
        'mobile-page-container--css-safe-top':
          !hasMobileHeader && safeAreaPolicy.headerlessTopOwner === 'css',
      }"
    >
      <router-view />
    </q-page-container>

    <q-footer v-if="!isKeyboardVisible" class="mobile-nav">
      <q-tabs
        dense
        no-caps
        align="justify"
        class="nav-tabs"
        :class="$q.dark.isActive ? 'bg-grey-9 text-primary' : 'bg-white text-primary'"
        :breakpoint="0"
      >
        <q-route-tab to="/" icon="home" label="Home" exact @click="onTabClick($event, '/')" />
        <q-route-tab
          to="/review"
          icon="repeat"
          label="Review"
          @click="onTabClick($event, '/review')"
        />
        <q-route-tab
          to="/learn"
          icon="school"
          label="Learn"
          @click="onTabClick($event, '/learn')"
        />
        <q-route-tab
          to="/words"
          icon="menu_book"
          label="Words"
          @click="onTabClick($event, '/words')"
        />
        <q-route-tab
          to="/more"
          icon="more_horiz"
          label="More"
          @click="onTabClick($event, '/more')"
        />
      </q-tabs>
    </q-footer>
  </q-layout>
</template>

<script setup lang="ts">
import { computed, provide } from 'vue';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import MobilePageHeader from '../components/mobile/MobilePageHeader.vue';
import {
  KEYBOARD_VIEWPORT_INJECTION_KEY,
  useKeyboardViewport,
} from '../composables/useKeyboardViewport';
import { safeAreaPolicy } from '../ios/safe-area-policy';
import { pushMobileRoute } from '../router/mobile-navigation';

const route = useRoute();
const router = useRouter();
const hasMobileHeader = computed(() => Boolean(route.meta.mobileHeader));
const keyboardViewport = useKeyboardViewport({
  getFocusedBlock: () => document.querySelector<HTMLElement>('[data-keyboard-scroll-block]'),
});
provide(KEYBOARD_VIEWPORT_INJECTION_KEY, keyboardViewport);
const { isKeyboardVisible } = keyboardViewport;

function onTabClick(event: Event, target: RouteLocationRaw): void {
  event.preventDefault();
  void pushMobileRoute(router, target).catch((error: unknown) => {
    console.error('Mobile tab navigation failed', error);
  });
}
</script>

<style scoped lang="scss">
/* Quasar applies env(safe-area-inset-bottom) to the footer q-tabs on native
 * iOS via body.q-ios-padding (QLayout.sass). On web iOS that class is absent,
 * so we only add the inset there to avoid doubling it on native. The padding
 * goes on .nav-tabs (not the footer) so the tab background — bg-white in light
 * mode, bg-grey-9 in dark mode — fills the home-indicator strip; the footer's
 * own default background is primary, which would otherwise show through. */
body:not(.q-ios-padding) .nav-tabs {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
</style>
