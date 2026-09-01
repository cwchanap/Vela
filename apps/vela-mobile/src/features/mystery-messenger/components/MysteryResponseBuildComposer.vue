<template>
  <div
    class="mystery-response-build-composer column q-gutter-sm"
    data-testid="mystery-response-build-composer"
  >
    <div v-if="selectedTokens.length > 0" class="row q-gutter-xs">
      <q-btn
        v-for="token in selectedTokens"
        :key="`selected-${token.id}`"
        class="mobile-touch-target"
        unelevated
        color="primary"
        lang="ja"
        :data-testid="`mystery-response-selected-${token.id}`"
        :label="token.text"
        :disable="disabled"
        @click="removeToken(token.id)"
      />
    </div>

    <div class="row q-gutter-xs">
      <q-btn
        v-for="token in availableTokens"
        :key="token.id"
        class="mobile-touch-target"
        outline
        lang="ja"
        :data-testid="`mystery-response-token-${token.id}`"
        :label="token.text"
        :disable="disabled"
        @click="addToken(token.id)"
      />
    </div>

    <div class="row q-gutter-sm">
      <q-btn
        class="mobile-touch-target col"
        outline
        label="Clear"
        data-testid="mystery-response-clear"
        :disable="disabled"
        @click="clearSelection"
      />
      <q-btn
        class="mobile-touch-target col"
        color="primary"
        label="Send"
        data-testid="mystery-response-send"
        :disable="disabled || selectedTokenIds.length === 0"
        @click="emit('submit', [...selectedTokenIds])"
      />
    </div>

    <p
      v-if="showHint"
      data-testid="mystery-response-hint-copy"
      class="q-my-none text-caption"
      role="note"
    >
      {{ scene.hint }}
    </p>
    <q-btn
      class="mobile-touch-target full-width"
      flat
      label="Hint"
      data-testid="mystery-response-hint"
      :disable="disabled"
      @click="showHint = !showHint"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { MysteryResponseBuildScene } from '../model';

const props = defineProps<{ scene: MysteryResponseBuildScene; disabled: boolean }>();
const emit = defineEmits<{ submit: [tokenIds: string[]] }>();

const selectedTokenIds = ref<string[]>([]);
const showHint = ref(false);

const selectedTokens = computed(() =>
  selectedTokenIds.value.flatMap((id) => {
    const token = props.scene.tokens.find((candidate) => candidate.id === id);
    return token ? [token] : [];
  }),
);
const availableTokens = computed(() =>
  props.scene.tokens.filter((token) => !selectedTokenIds.value.includes(token.id)),
);

function addToken(tokenId: string): void {
  selectedTokenIds.value = [...selectedTokenIds.value, tokenId];
}

function removeToken(tokenId: string): void {
  selectedTokenIds.value = selectedTokenIds.value.filter((id) => id !== tokenId);
}

function clearSelection(): void {
  selectedTokenIds.value = [];
}
</script>
