import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar } from 'quasar';
import SentenceGame from './SentenceGame.vue';

vi.mock('src/components/games/SentenceBuilder.vue', () => ({
  default: {
    template: '<div data-testid="sentence-builder">SentenceBuilder</div>',
    name: 'SentenceBuilder',
  },
}));

describe('SentenceGame', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('renders without errors', () => {
    const wrapper = mount(SentenceGame, {
      global: {
        plugins: [Quasar],
        stubs: {
          'q-page': { template: '<div><slot /></div>' },
          SentenceBuilder: { template: '<div>SentenceBuilder</div>' },
        },
      },
    });
    expect(wrapper.exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders the page title', () => {
    const wrapper = mount(SentenceGame, {
      global: {
        plugins: [Quasar],
        stubs: {
          'q-page': { template: '<div><slot /></div>' },
          SentenceBuilder: { template: '<div>SentenceBuilder</div>' },
        },
      },
    });
    expect(wrapper.text()).toContain('Sentence Anagram Game');
    wrapper.unmount();
  });

  it('includes SentenceBuilder component', () => {
    const wrapper = mount(SentenceGame, {
      global: {
        plugins: [Quasar],
        stubs: {
          'q-page': { template: '<div><slot /></div>' },
          SentenceBuilder: {
            template: '<div data-testid="sentence-builder">SentenceBuilder</div>',
          },
        },
      },
    });
    expect(wrapper.find('[data-testid="sentence-builder"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
