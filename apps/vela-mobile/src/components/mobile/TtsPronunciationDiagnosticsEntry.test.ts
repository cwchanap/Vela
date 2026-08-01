import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import TtsPronunciationDiagnosticsEntry from './TtsPronunciationDiagnosticsEntry.vue';
import { pushMobileRoute } from 'src/router/mobile-navigation';

vi.mock('src/router/mobile-navigation', () => ({
  pushMobileRoute: vi.fn().mockResolvedValue({ kind: 'pushed' }),
}));

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: { template: '<div />' } }],
});

function mountEntry() {
  return mount(TtsPronunciationDiagnosticsEntry, {
    global: {
      plugins: [Quasar, router],
    },
  });
}

describe('TtsPronunciationDiagnosticsEntry', () => {
  it('navigates to authenticated TTS diagnostics', async () => {
    const wrapper = mountEntry();

    await wrapper.get('[data-testid="tts-pronunciation-entry"]').trigger('click');

    expect(pushMobileRoute).toHaveBeenCalledWith(router, '/diagnostics/tts-pronunciation');
  });
});
