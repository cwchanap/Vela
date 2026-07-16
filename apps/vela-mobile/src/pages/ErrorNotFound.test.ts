import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar, QLayout, QPageContainer } from 'quasar';
import { defineComponent } from 'vue';
import ErrorNotFound from './ErrorNotFound.vue';

// q-page must be a deep child of q-layout; wrap so Quasar renders under jsdom.
const Host = defineComponent({
  components: { QLayout, QPageContainer, ErrorNotFound },
  template:
    '<q-layout view="hHh Lpr fFf"><q-page-container><error-not-found/></q-page-container></q-layout>',
});

const mountPage = () => mount(Host, { global: { plugins: [Quasar] } });

describe('ErrorNotFound', () => {
  it('renders the 404 status', () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain('404');
  });

  it('renders a Go Home button linking to /', () => {
    const wrapper = mountPage();
    const btn = wrapper.findComponent({ name: 'QBtn' });
    expect(btn.exists()).toBe(true);
    expect(btn.props('to')).toBe('/');
  });
});
