<template>
  <q-layout view="hHh lpR fFf" class="auth-layout">
    <q-page-container class="auth-page-container">
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
// Layout for authentication pages
</script>

<style lang="scss">
html,
body,
#q-app {
  height: 100%;
  margin: 0;
  padding: 0;
}

.auth-layout {
  height: 100vh;
  width: 100%;
  margin: 0;
  padding: 0;
}

.auth-page-container {
  height: 100%;
  width: 100%;
  margin: 0;
  padding: 0;
}

/* Default styling for auth pages (signup, reset password, etc.) */
.auth-page-container :deep(.auth-page) {
  width: 100%;
  max-width: 400px;
  padding: 2rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  margin: 1rem;
}

body.body--dark .auth-page-container :deep(.auth-page) {
  background: #1e1e1e;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.auth-subtitle {
  color: #7f8c8d;
  margin: 0 0 1rem;
  font-size: 0.9rem;
}

body.body--dark .auth-subtitle {
  color: #b8b8b8;
}

.auth-content {
  margin-bottom: 2rem;
}

.auth-footer {
  border-top: 1px solid #ecf0f1;
  padding-top: 1rem;
}

body.body--dark .auth-footer {
  border-top: 1px solid #424242;
}

@media (max-width: 480px) {
  .auth-container {
    padding: 1.5rem;
    margin: 0.5rem;
  }

  .auth-title {
    font-size: 1.25rem;
  }

  .auth-page-container :deep(.auth-page) {
    margin: 0.5rem;
    padding: 1.5rem;
  }
}
</style>
