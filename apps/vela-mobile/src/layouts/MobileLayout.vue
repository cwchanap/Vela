<template>
  <q-layout view="hHh lpR fFf">
    <q-page-container>
      <router-view />
    </q-page-container>

    <q-footer class="mobile-nav">
      <q-tabs dense no-caps align="justify" class="bg-white text-primary nav-tabs" :breakpoint="0">
        <q-route-tab to="/" icon="home" label="Home" />
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
.mobile-nav {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
</style>
