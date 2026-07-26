<script lang="ts">
import type { QInput } from 'quasar';
import { defineComponent, onBeforeUnmount, onMounted, ref } from 'vue';

export default defineComponent({
  name: 'JapaneseInputProbe',
  setup() {
    const qInput = ref<InstanceType<typeof QInput> | null>(null);
    const fieldModel = ref('');
    const draft = ref('');
    const committed = ref('');
    const submitted = ref('');
    const isComposing = ref(false);

    let nativeInput: HTMLInputElement | null = null;

    function nativeValue(event: Event): string {
      return (event.currentTarget as HTMLInputElement).value;
    }

    function onCompositionStart(): void {
      isComposing.value = true;
    }

    function onNativeInput(event: Event): void {
      draft.value = nativeValue(event);
    }

    function onFieldModelUpdate(value: string | number | null): void {
      if (isComposing.value) return;
      fieldModel.value = String(value ?? '');
    }

    function onCompositionEnd(event: CompositionEvent): void {
      const value = nativeValue(event);
      isComposing.value = false;
      fieldModel.value = value;
      committed.value = value;
      draft.value = value;
    }

    function submitExactValue(): void {
      if (isComposing.value) return;
      submitted.value = qInput.value?.nativeEl?.value ?? fieldModel.value;
    }

    function onNativeKeydown(event: KeyboardEvent): void {
      if (event.key !== 'Enter') return;
      if (isComposing.value || event.isComposing) return;
      event.preventDefault();
      submitExactValue();
    }

    function blurInput(): void {
      qInput.value?.nativeEl?.blur();
    }

    onMounted(() => {
      nativeInput = (qInput.value?.nativeEl as HTMLInputElement | undefined) ?? null;
      nativeInput?.addEventListener('compositionstart', onCompositionStart);
      nativeInput?.addEventListener('input', onNativeInput);
      nativeInput?.addEventListener('compositionend', onCompositionEnd);
      nativeInput?.addEventListener('keydown', onNativeKeydown);
    });

    onBeforeUnmount(() => {
      nativeInput?.removeEventListener('compositionstart', onCompositionStart);
      nativeInput?.removeEventListener('input', onNativeInput);
      nativeInput?.removeEventListener('compositionend', onCompositionEnd);
      nativeInput?.removeEventListener('keydown', onNativeKeydown);
      nativeInput = null;
    });

    return {
      blurInput,
      committed,
      draft,
      fieldModel,
      isComposing,
      onFieldModelUpdate,
      qInput,
      submitExactValue,
      submitted,
    };
  },
});
</script>

<template>
  <section data-testid="ime-probe" @click.self="blurInput">
    <q-input
      ref="qInput"
      :model-value="fieldModel"
      label="Japanese input"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      @update:model-value="onFieldModelUpdate"
    />
    <div data-testid="ime-model">Model: {{ fieldModel }}</div>
    <div data-testid="ime-draft">Draft: {{ draft }}</div>
    <div data-testid="ime-committed">Committed: {{ committed }}</div>
    <div data-testid="ime-submitted">Submitted: {{ submitted }}</div>
    <div data-testid="ime-composing">Composing: {{ isComposing ? 'yes' : 'no' }}</div>
    <q-btn data-testid="ime-done" class="mobile-touch-target" label="Done" @click="blurInput" />
    <q-btn
      data-testid="ime-submit"
      class="mobile-touch-target"
      label="Submit"
      color="primary"
      @click="submitExactValue"
    />
  </section>
</template>
