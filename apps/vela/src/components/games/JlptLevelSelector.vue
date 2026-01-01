<template>
  <div class="jlpt-level-selector">
    <div class="text-subtitle2 q-mb-sm">JLPT Level</div>
    <!-- Individual level buttons for multi-select -->
    <div class="row q-gutter-sm justify-center">
      <q-btn
        data-testid="jlpt-level-all"
        :class="{ 'bg-primary text-white': isAllSelected, 'bg-grey-3': !isAllSelected }"
        :flat="!isAllSelected"
        rounded
        no-caps
        @click="selectAll"
      >
        All Levels
      </q-btn>
      <q-btn
        v-for="level in jlptLevels"
        :key="level.value"
        :data-testid="`jlpt-level-${level.value}`"
        :class="{
          'bg-primary text-white': isSelected(level.value),
          'bg-grey-3': !isSelected(level.value),
        }"
        :flat="!isSelected(level.value)"
        rounded
        no-caps
        @click="toggleLevel(level.value)"
      >
        <div class="column items-center">
          <span class="text-weight-bold">{{ level.label }}</span>
          <span class="text-caption text-grey-6">{{ level.difficulty }}</span>
        </div>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { JLPTLevel } from 'src/types/database';

interface JlptOption {
  value: JLPTLevel;
  label: string;
  difficulty: string;
}

const props = defineProps<{
  modelValue: JLPTLevel[];
}>();

const emit = defineEmits<{
  (_e: 'update:modelValue', _value: JLPTLevel[]): void;
}>();

const jlptLevels: JlptOption[] = [
  { value: 5, label: 'N5', difficulty: 'Beginner' },
  { value: 4, label: 'N4', difficulty: 'Elementary' },
  { value: 3, label: 'N3', difficulty: 'Intermediate' },
  { value: 2, label: 'N2', difficulty: 'Upper-Int.' },
  { value: 1, label: 'N1', difficulty: 'Advanced' },
];

const isAllSelected = computed(() => props.modelValue.length === 0);

const isSelected = (level: JLPTLevel) => props.modelValue.includes(level);

const selectAll = () => {
  emit('update:modelValue', []);
};

const toggleLevel = (level: JLPTLevel) => {
  const current = [...props.modelValue];
  const index = current.indexOf(level);

  if (index === -1) {
    current.push(level);
    current.sort((a, b) => b - a); // Sort descending (N5 first)
  } else {
    current.splice(index, 1);
  }

  emit('update:modelValue', current);
};
</script>

<style scoped>
.jlpt-level-selector {
  width: 100%;
}
</style>
