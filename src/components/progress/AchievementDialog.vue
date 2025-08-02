<template>
  <q-dialog v-model="isOpen" persistent transition-show="scale" transition-hide="scale">
    <q-card class="achievement-dialog" style="min-width: 400px; max-width: 500px">
      <q-card-section class="text-center q-pb-none">
        <div class="achievement-celebration">
          <q-icon name="celebration" color="warning" size="64px" class="celebration-icon" />
          <div class="text-h5 q-mt-md text-weight-bold">
            {{ achievements.length === 1 ? 'Achievement Unlocked!' : 'Achievements Unlocked!' }}
          </div>
        </div>
      </q-card-section>

      <q-card-section>
        <div class="achievements-list">
          <div
            v-for="(achievement, index) in achievements"
            :key="achievement.id"
            class="achievement-card q-mb-md"
            :style="{ animationDelay: `${index * 0.2}s` }"
          >
            <div class="achievement-content">
              <q-avatar
                :color="getCategoryColor(achievement.category)"
                text-color="white"
                size="56px"
              >
                <q-icon :name="achievement.icon" size="32px" />
              </q-avatar>

              <div class="achievement-info">
                <div class="achievement-name">{{ achievement.name }}</div>
                <div class="achievement-description">{{ achievement.description }}</div>
                <div v-if="achievement.experience_reward > 0" class="achievement-reward">
                  <q-badge color="warning" class="q-mt-sm">
                    +{{ achievement.experience_reward }} XP
                  </q-badge>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="total-experience q-mt-lg text-center" v-if="totalExperience > 0">
          <q-separator class="q-mb-md" />
          <div class="text-h6 text-weight-bold text-warning">Total: +{{ totalExperience }} XP</div>
        </div>
      </q-card-section>

      <q-card-actions align="center" class="q-pt-none">
        <q-btn color="primary" label="Awesome!" size="lg" @click="closeDialog" class="q-px-xl" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import type { Achievement } from 'src/services/progressService';

interface Props {
  modelValue: boolean;
  achievements: Achievement[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  close: [];
}>();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const totalExperience = computed(() => {
  return props.achievements.reduce((sum, achievement) => sum + achievement.experience_reward, 0);
});

const getCategoryColor = (category: string) => {
  const colorMap: { [key: string]: string } = {
    vocabulary: 'primary',
    grammar: 'secondary',
    streak: 'orange',
    level: 'purple',
    special: 'pink',
  };
  return colorMap[category] || 'grey';
};

const closeDialog = () => {
  isOpen.value = false;
  emit('close');
};

// Auto-close after 10 seconds if user doesn't interact
let autoCloseTimer: NodeJS.Timeout;

watch(isOpen, (newValue) => {
  if (newValue) {
    autoCloseTimer = setTimeout(() => {
      closeDialog();
    }, 10000);
  } else {
    if (autoCloseTimer) {
      clearTimeout(autoCloseTimer);
    }
  }
});
</script>

<style scoped lang="scss">
.achievement-dialog {
  .achievement-celebration {
    .celebration-icon {
      animation: bounce 1s ease-in-out infinite;
    }
  }
}

.achievement-card {
  background: linear-gradient(135deg, rgba(255, 193, 7, 0.1) 0%, rgba(255, 193, 7, 0.05) 100%);
  border: 2px solid rgba(255, 193, 7, 0.3);
  border-radius: 12px;
  padding: 16px;
  animation: slideInUp 0.6s ease-out both;

  .achievement-content {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .achievement-info {
    flex: 1;
  }

  .achievement-name {
    font-size: 1.1rem;
    font-weight: 600;
    line-height: 1.3;
    color: var(--q-text-primary);
  }

  .achievement-description {
    font-size: 0.9rem;
    color: var(--q-text-grey-7);
    margin-top: 4px;
    line-height: 1.4;
  }

  .achievement-reward {
    margin-top: 8px;
  }
}

@keyframes bounce {
  0%,
  20%,
  53%,
  80%,
  100% {
    transform: translate3d(0, 0, 0);
  }
  40%,
  43% {
    transform: translate3d(0, -15px, 0);
  }
  70% {
    transform: translate3d(0, -7px, 0);
  }
  90% {
    transform: translate3d(0, -2px, 0);
  }
}

@keyframes slideInUp {
  from {
    transform: translate3d(0, 40px, 0);
    opacity: 0;
  }
  to {
    transform: translate3d(0, 0, 0);
    opacity: 1;
  }
}

.total-experience {
  background: rgba(255, 193, 7, 0.1);
  border-radius: 8px;
  padding: 12px;
}
</style>
