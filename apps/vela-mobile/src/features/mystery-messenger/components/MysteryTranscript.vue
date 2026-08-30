<template>
  <ol class="mystery-transcript column q-gutter-md" data-testid="mystery-transcript">
    <li
      v-for="(item, index) in items"
      :key="index"
      class="transcript-item"
      :data-testid="`mystery-transcript-${item.kind}`"
    >
      <div class="row items-start q-gutter-sm">
        <div class="col">
          <p v-if="item.kind === 'message'" lang="ja" class="text-body1 q-my-none">
            {{ item.text }}
          </p>
          <template v-else-if="item.kind === 'choice-result'">
            <p lang="ja" class="q-my-none">{{ item.prompt }}</p>
            <p lang="ja" class="q-my-none" :data-testid="`mystery-choice-feedback-${item.sceneId}`">
              {{ item.selectedLabel }} · {{ item.feedback }}
            </p>
          </template>
          <p v-else-if="item.kind === 'choice-prompt'" lang="ja" class="q-my-none">
            {{ item.prompt }}
          </p>
          <template v-else>
            <h2 lang="ja" class="text-h6 q-my-none">{{ item.title }}</h2>
            <p lang="ja" class="q-my-none">{{ item.text }}</p>
          </template>
        </div>
        <q-btn
          flat
          round
          dense
          icon="volume_up"
          class="transcript-replay"
          :data-testid="`mystery-replay-${item.sceneId}`"
          aria-label="Replay audio"
          @click="emit('replay', item.sceneId)"
        />
      </div>
    </li>
  </ol>
</template>

<script setup lang="ts">
import type { MysteryTranscriptItem } from '../model';

defineProps<{ items: readonly MysteryTranscriptItem[] }>();
const emit = defineEmits<{ replay: [sceneId: string] }>();
</script>
