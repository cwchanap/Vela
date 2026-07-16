import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar, QLayout, QPageContainer } from 'quasar';
import { defineComponent } from 'vue';
import LearnPage from './LearnPage.vue';
import ReviewPage from './ReviewPage.vue';
import WordsPage from './WordsPage.vue';
import MorePage from './MorePage.vue';

// q-page must be a deep child of q-layout; wrap so Quasar renders under jsdom.
const mountPage = (Page: any) => {
  const Host = defineComponent({
    components: { QLayout, QPageContainer, Page },
    template:
      '<q-layout view="hHh Lpr fFf"><q-page-container><page/></q-page-container></q-layout>',
  });
  return mount(Host, { global: { plugins: [Quasar] } });
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
