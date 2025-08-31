<template>
  <q-item class="achievement-item" :class="{ 'achievement-earned': achievement.earned_at }">
    <q-item-section avatar>
      <q-avatar :color="categoryColor" text-color="white" size="48px">
        <q-icon :name="achievement.icon" size="24px" />
      </q-avatar>
    </q-item-section>

    <q-item-section>
      <q-item-label class="achievement-name">
        {{ achievement.name }}
        <q-badge v-if="achievement.experience_reward > 0" color="warning" class="q-ml-sm">
          +{{ achievement.experience_reward }} XP
        </q-badge>
      </q-item-label>
      <q-item-label caption class="achievement-description">
        {{ achievement.description }}
      </q-item-label>
      <q-item-label v-if="achievement.earned_at" caption class="achievement-date">
        Earned {{ formatDate(achievement.earned_at) }}
      </q-item-label>
    </q-item-section>

    <q-item-section side v-if="achievement.earned_at">
      <q-icon name="check_circle" color="positive" size="24px" />
    </q-item-section>
  </q-item>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Achievement } from 'src/services/progressService';

interface Props {
  achievement: Achievement;
}

const props = defineProps<Props>();

const categoryColor = computed(() => {
  const colorMap: { [key: string]: string } = {
    vocabulary: 'primary',
    grammar: 'secondary',
    streak: 'orange',
    level: 'purple',
    special: 'pink',
  };
  return colorMap[props.achievement.category] || 'grey';
});

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 1) return 'today';
  if (diffDays === 2) return 'yesterday';
  if (diffDays <= 7) return `${diffDays - 1} days ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
};
</script>

<style scoped lang="scss">
.achievement-item {
  border-radius: 8px;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: rgba(0, 0, 0, 0.04);
  }

  &.achievement-earned {
    .achievement-name {
      font-weight: 600;
    }
  }
}

.achievement-name {
  font-size: 1rem;
  line-height: 1.3;
}

.achievement-description {
  line-height: 1.4;
  margin-top: 2px;
}

.achievement-date {
  color: var(--q-positive);
  font-weight: 500;
  margin-top: 4px;
}
</style>
