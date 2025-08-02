<template>
  <q-card class="skill-category-card" :style="{ borderLeft: `4px solid ${skill.color}` }">
    <q-card-section class="q-pb-none">
      <div class="skill-header">
        <q-icon :name="skill.icon" :color="skill.color" size="32px" />
        <div class="skill-info">
          <div class="skill-name">{{ skill.name }}</div>
          <div class="skill-level">Level {{ skill.level }}</div>
        </div>
      </div>
    </q-card-section>

    <q-card-section>
      <div class="skill-description text-caption text-grey-6 q-mb-md">
        {{ skill.description }}
      </div>

      <div class="progress-section">
        <div class="progress-info">
          <span class="text-caption"
            >{{ skill.experience }} / {{ skill.experience_to_next_level }} XP</span
          >
          <span class="text-caption">{{ progressPercentage }}%</span>
        </div>
        <q-linear-progress
          :value="progressPercentage / 100"
          :color="skill.color"
          size="8px"
          class="q-mt-xs"
        />
      </div>

      <div class="skill-stats q-mt-md">
        <div class="stat-row">
          <q-icon name="trending_up" size="16px" class="text-grey-6" />
          <span class="text-caption">Next level in {{ experienceNeeded }} XP</span>
        </div>
      </div>
    </q-card-section>

    <q-card-actions v-if="showActions">
      <q-btn flat :color="skill.color" label="Practice" @click="$emit('practice', skill)" />
      <q-space />
      <q-btn flat color="grey-6" label="Details" @click="$emit('details', skill)" />
    </q-card-actions>
  </q-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SkillCategory } from 'src/services/progressService';

interface Props {
  skill: SkillCategory;
  showActions?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showActions: false,
});

defineEmits<{
  practice: [skill: SkillCategory];
  details: [skill: SkillCategory];
}>();

const progressPercentage = computed(() => {
  if (props.skill.experience_to_next_level === 0) return 100;
  return Math.round((props.skill.experience / props.skill.experience_to_next_level) * 100);
});

const experienceNeeded = computed(() => {
  return props.skill.experience_to_next_level - props.skill.experience;
});
</script>

<style scoped lang="scss">
.skill-category-card {
  height: 100%;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
}

.skill-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.skill-info {
  flex: 1;
}

.skill-name {
  font-weight: 600;
  font-size: 1rem;
  line-height: 1.2;
}

.skill-level {
  font-size: 0.875rem;
  color: var(--q-text-grey-6);
  margin-top: 2px;
}

.skill-description {
  line-height: 1.4;
}

.progress-section {
  .progress-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}

.skill-stats {
  .stat-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
}
</style>
