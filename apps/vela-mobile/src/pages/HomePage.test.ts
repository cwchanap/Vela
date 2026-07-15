import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar, QLayout, QPageContainer } from 'quasar';
import { defineComponent } from 'vue';
import HomePage from './HomePage.vue';

// q-page must be a deep child of q-layout; wrap HomePage so Quasar renders its
// content under jsdom instead of silently emitting nothing.
const Host = defineComponent({
  components: { QLayout, QPageContainer, HomePage },
  template:
    '<q-layout view="hHh Lpr fFf"><q-page-container><home-page/></q-page-container></q-layout>',
});

const mountPage = () => mount(Host, { global: { plugins: [Quasar] } });

describe('HomePage', () => {
  it('renders the app name', () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain('Vela');
  });

  it('renders the app version', () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain('0.0.1');
  });

  it('renders the M1 scaffold label', () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain('M1');
  });
});
