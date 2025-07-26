<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-md">
      <q-avatar size="100px" class="q-mr-md">
        <img :src="user?.avatar_url || 'https://cdn.quasar.dev/img/boy-avatar.png'" />
      </q-avatar>
      <div>
        <h4 class="text-h4 q-ma-none">Welcome back, {{ userName }}!</h4>
        <p class="text-subtitle1 text-grey-7">Let's continue your Japanese learning journey.</p>
      </div>
    </div>

    <div class="q-gutter-md row">
      <q-card class="col-12 col-md-4">
        <q-card-section>
          <div class="text-h6">Learning Progress</div>
        </q-card-section>
        <q-card-section>
          <div class="text-center">
            <q-circular-progress
              show-value
              font-size="12px"
              :value="75"
              size="120px"
              :thickness="0.22"
              color="primary"
              track-color="grey-3"
              class="q-ma-md"
            >
              75% Overall
            </q-circular-progress>
          </div>
        </q-card-section>
      </q-card>

      <q-card class="col-12 col-md-4">
        <q-card-section>
          <div class="text-h6">Current Streak</div>
        </q-card-section>
        <q-card-section class="text-center">
          <q-icon name="whatshot" color="orange" size="64px" />
          <div class="text-h4 q-mt-sm">{{ userStreak }} days</div>
        </q-card-section>
      </q-card>

      <q-card class="col-12 col-md-4">
        <q-card-section>
          <div class="text-h6">Next Lesson</div>
        </q-card-section>
        <q-card-section>
          <q-item>
            <q-item-section avatar>
              <q-icon name="school" size="lg" />
            </q-item-section>
            <q-item-section>
              <q-item-label class="text-h6">Hiragana Basics</q-item-label>
              <q-item-label caption>Master the foundational characters.</q-item-label>
            </q-item-section>
          </q-item>
          <q-btn color="primary" label="Start Lesson" class="full-width q-mt-md" />
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useAuthStore } from 'src/stores/auth';
import { storeToRefs } from 'pinia';

const authStore = useAuthStore();
const { user, userName, userStreak } = storeToRefs(authStore);
</script>

<style scoped lang="scss">
.text-h4 {
  font-weight: 600;
}
</style>
