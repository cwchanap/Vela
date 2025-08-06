<template>
  <q-layout view="hHh lpR fFf">
    <q-page-container>
      <div class="auth-layout">
        <div class="auth-container">
          <div class="auth-header">
            <q-img
              src="/icons/favicon-96x96.png"
              alt="Japanese Learning App"
              width="64px"
              height="64px"
              class="auth-logo"
            />
            <h1 class="auth-title">{{ config.app.name }}</h1>
            <p class="auth-subtitle">Learn Japanese with interactive games and AI assistance</p>
          </div>

          <div class="auth-content">
            <router-view />
          </div>

          <div class="auth-footer">
            <p class="text-caption text-dark">Version {{ config.app.version }}</p>
          </div>
        </div>
      </div>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { config } from 'src/config';
</script>

<style lang="scss" scoped>
.auth-layout {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 1rem;
}

.auth-container {
  background: white;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
  padding: 2rem;
  width: 100%;
  max-width: 400px;
  text-align: center;
}

.auth-header {
  margin-bottom: 2rem;
}

.auth-logo {
  margin: 0 auto 1rem;
  border-radius: 8px;
}

.auth-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #2c3e50;
  margin: 0 0 0.5rem;
}

.auth-subtitle {
  color: #7f8c8d;
  margin: 0 0 1rem;
  font-size: 0.9rem;
}

.auth-content {
  margin-bottom: 2rem;
}

.auth-footer {
  border-top: 1px solid #ecf0f1;
  padding-top: 1rem;
}

@media (max-width: 480px) {
  .auth-container {
    padding: 1.5rem;
    margin: 0.5rem;
  }

  .auth-title {
    font-size: 1.25rem;
  }
}
</style>
