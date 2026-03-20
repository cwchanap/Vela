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

const mountComponent = () =>
  mount(SentenceGame, {
    global: {
      plugins: [Quasar],
      stubs: {
        'q-page': { template: '<div><slot /></div>' },
      },
    },
  });

describe('SentenceGame', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('renders without errors', () => {
    const wrapper = mountComponent();
    expect(wrapper.exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders the page title', () => {
    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('Sentence Anagram Game');
    wrapper.unmount();
  });

  it('includes SentenceBuilder component', () => {
    const wrapper = mountComponent();
    expect(wrapper.find('[data-testid="sentence-builder"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
