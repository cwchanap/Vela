import { describe, it, expect, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { Quasar, QLayout, QPageContainer } from 'quasar';
import { defineComponent, type Component } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import LearnPage from './LearnPage.vue';
import ReviewPage from './ReviewPage.vue';
import WordsPage from './WordsPage.vue';
import MorePage from './MorePage.vue';
import type { MobileAuthCoordinator } from '../auth/mobile-auth-contract';
import { MOBILE_AUTH_KEY } from '../services/mobile-auth';

const coordinator: MobileAuthCoordinator = {
  state: {
    phase: 'authenticated',
    operation: 'idle',
    sessionUsable: true,
    errorCode: null,
    retryAction: null,
    notice: null,
    user: { userId: 'user-1', email: null },
  },
  initialize: vi.fn().mockResolvedValue(undefined),
  startSignIn: vi.fn().mockResolvedValue(undefined),
  completeCallback: vi.fn().mockResolvedValue(undefined),
  retryCurrentOperation: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn().mockResolvedValue(undefined),
};

// q-page must be a deep child of q-layout; wrap so Quasar renders under jsdom.
const mountPage = (Page: Component) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  });
  const Host = defineComponent({
    components: { QLayout, QPageContainer, Page },
    template:
      '<q-layout view="hHh Lpr fFf"><q-page-container><page/></q-page-container></q-layout>',
  });
  return mount(Host, {
    global: {
      plugins: [Quasar, router],
      provide: {
        [MOBILE_AUTH_KEY as symbol]: coordinator,
      },
    },
  });
};

describe.each([
  ['LearnPage', LearnPage, 'Learn'],
  ['ReviewPage', ReviewPage, 'Review'],
  ['WordsPage', WordsPage, 'Words'],
  ['MorePage', MorePage, 'More'],
] as const)('%s', (_name, Page, label) => {
  it('renders the section label', () => {
    const wrapper = mountPage(Page);
    expect(wrapper.text()).toContain(label);
  });

  it('renders the Coming soon placeholder', () => {
    const wrapper = mountPage(Page);
    expect(wrapper.text()).toContain('Coming soon');
  });
});

describe('MorePage diagnostics entry', () => {
  it('shows the iOS interaction diagnostics entry in development', async () => {
    const wrapper = mountPage(MorePage);
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="ios-interaction-entry"]').exists()).toBe(true);
    });
    const entry = wrapper.find('[data-testid="ios-interaction-entry"]');
    expect(entry.text()).toContain('iOS Interaction Diagnostics');
  });
});
