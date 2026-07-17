<template>
  <q-layout view="hHh lpR fFf">
    <q-page-container>
      <router-view />
    </q-page-container>

    <q-footer class="mobile-nav">
      <q-tabs
        dense
        no-caps
        align="justify"
        class="nav-tabs"
        :class="$q.dark.isActive ? 'bg-grey-9 text-primary' : 'bg-white text-primary'"
        :breakpoint="0"
      >
        <q-route-tab to="/" icon="home" label="Home" exact />
        <q-route-tab to="/review" icon="repeat" label="Review" />
        <q-route-tab to="/learn" icon="school" label="Learn" />
        <q-route-tab to="/words" icon="menu_book" label="Words" />
        <q-route-tab to="/more" icon="more_horiz" label="More" />
      </q-tabs>
    </q-footer>
  </q-layout>
</template>

<script setup lang="ts"></script>

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
