<template>
  <q-item
    clickable
    :to="to"
    :disable="disabled"
    class="navigation-link"
    :class="{ 'navigation-link--disabled': disabled }"
    @click="handleClick"
  >
    <q-item-section avatar>
      <q-icon :name="icon" :color="disabled ? 'grey-5' : 'primary'" />
    </q-item-section>

    <q-item-section>
      <q-item-label :class="{ 'text-grey-8': disabled }">
        {{ title }}
        <q-chip
          v-if="disabled"
          size="xs"
          color="grey-4"
          text-color="grey-7"
          label="Soon"
          class="q-ml-sm"
        />
      </q-item-label>
      <q-item-label caption :class="{ 'text-grey-7': disabled }">
        {{ caption }}
      </q-item-label>
    </q-item-section>
  </q-item>
</template>

<script setup lang="ts">
import { useQuasar } from 'quasar';

interface Props {
  title: string;
  caption?: string;
  icon: string;
  to?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
});

const emit = defineEmits<{
  click: [];
}>();

const $q = useQuasar();

const handleClick = () => {
  if (props.disabled) {
    $q.notify({
      type: 'info',
      message: `${props.title} is coming soon!`,
      timeout: 2000,
    });
    return;
  }

  emit('click');
};
</script>

<style scoped>
.navigation-link {
  border-radius: 8px;
  margin: 4px 8px;
}

.navigation-link:hover:not(.navigation-link--disabled) {
  background-color: rgba(25, 118, 210, 0.08);
}

.navigation-link--disabled {
  cursor: not-allowed;
}

.navigation-link--disabled:hover {
  background-color: transparent;
}
</style>
