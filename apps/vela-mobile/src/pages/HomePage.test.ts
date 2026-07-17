import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar, QLayout, QPageContainer } from 'quasar';
import { defineComponent } from 'vue';
import HomePage from './HomePage.vue';
import { config } from 'src/config';

// q-page must be a deep child of q-layout; wrap HomePage so Quasar renders its
// content under jsdom instead of silently emitting nothing.
const Host = defineComponent({
  components: { QLayout, QPageContainer, HomePage },
  template:
    '<q-layout view="hHh Lpr fFf"><q-page-container><home-page/></q-page-container></q-layout>',
});

const mountPage = () => mount(Host, { global: { plugins: [Quasar] } });

describe('HomePage', () => {
  afterEach(() => {
    vi.doUnmock('src/config');
    vi.resetModules();
  });

  it('renders the app name', () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain(config.app.name);
  });

  it('renders the app version', () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain(config.app.version);
  });

  it('renders the M1 scaffold label', () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain('M1');
  });

  it('shows the Development chip in dev mode', () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain('Development');
    expect(wrapper.find('.q-chip').text()).toContain('Development');
  });

  it('shows the Production chip when config.app.isDev is false', async () => {
    vi.doMock('src/config', () => ({
      config: {
        app: { name: 'Vela', version: '0.0.1', isDev: false, isProd: true },
      },
    }));
    vi.resetModules();
    const { default: HomePageProd } = await import('./HomePage.vue');
    const ProdHost = defineComponent({
      components: { QLayout, QPageContainer, HomePageProd },
      template:
        '<q-layout view="hHh Lpr fFf"><q-page-container><home-page-prod/></q-page-container></q-layout>',
    });
    const wrapper = mount(ProdHost, { global: { plugins: [Quasar] } });
    expect(wrapper.text()).toContain('Production');
    expect(wrapper.text()).not.toContain('Development');
  });
});
