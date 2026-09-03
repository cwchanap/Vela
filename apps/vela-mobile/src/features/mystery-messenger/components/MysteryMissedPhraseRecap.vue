<template>
  <section data-testid="mystery-recap" class="mystery-missed-phrase-recap">
    <p v-if="items.length === 0" class="q-my-none text-body1">No missed phrases this run.</p>
    <ol v-else class="column q-gutter-md q-my-none">
      <li
        v-for="item in items"
        :key="item.phraseId"
        class="recap-row"
        :data-testid="`mystery-recap-phrase-${item.phraseId}`"
      >
        <p
          lang="ja"
          class="text-body1 q-my-none"
          :data-testid="`mystery-recap-text-${item.phraseId}`"
        >
          {{ item.text }}
        </p>
        <p lang="ja" class="q-my-none" :data-testid="`mystery-recap-reading-${item.phraseId}`">
          {{ item.reading }}
        </p>
        <p class="q-my-none" :data-testid="`mystery-recap-meaning-${item.phraseId}`">
          {{ item.meaning }}
        </p>
        <p
          lang="ja"
          class="q-my-none text-caption"
          :data-testid="`mystery-recap-prompt-${item.phraseId}`"
        >
          {{ item.sourcePrompt }}
        </p>
        <div class="row items-center q-gutter-sm">
          <q-btn
            class="mobile-touch-target"
            outline
            label="Replay"
            :data-testid="`mystery-recap-replay-${item.phraseId}`"
            @click="emit('replay', item.phraseId)"
          />
          <p
            v-if="rowStatus(item) !== null"
            class="q-my-none"
            :role="rowStatus(item)!.role"
            :data-testid="`mystery-recap-status-${item.phraseId}`"
          >
            {{ rowStatus(item)!.text }}
          </p>
        </div>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import type { MysteryMissedPhraseRecapItem } from '../model';

type PlaybackKind = 'preparing' | 'ready' | 'playing' | 'error';

const props = defineProps<{
  items: readonly MysteryMissedPhraseRecapItem[];
  activePhraseId?: string | undefined;
  playbackKind?: PlaybackKind | undefined;
  playbackError?: string | undefined;
}>();

const emit = defineEmits<{ replay: [phraseId: string] }>();

function rowStatus(item: MysteryMissedPhraseRecapItem): { role: string; text: string } | null {
  if (item.phraseId !== props.activePhraseId) return null;
  switch (props.playbackKind) {
    case 'preparing':
      return { role: 'status', text: 'Preparing audio…' };
    case 'ready':
      return { role: 'status', text: 'Tap Replay again' };
    case 'playing':
      return { role: 'status', text: 'Playing audio…' };
    case 'error':
      return {
        role: 'alert',
        text: props.playbackError
          ? `Audio playback failed: ${props.playbackError}`
          : 'Audio playback failed',
      };
    default:
      return null;
  }
}
</script>
