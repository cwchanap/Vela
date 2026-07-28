<template>
  <MobileAuthGate>
    <router-view />
  </MobileAuthGate>
</template>

<script setup lang="ts">
import MobileAuthGate from './components/mobile/MobileAuthGate.vue';
</script>
