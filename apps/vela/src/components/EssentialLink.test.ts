import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import EssentialLink from './EssentialLink.vue';

const mountComponent = (props: Record<string, unknown> = {}) =>
  mount(EssentialLink, {
    props: {
      title: 'Read the docs',
      ...props,
    },
    global: {
      stubs: {
        QItem: {
          name: 'QItem',
          props: ['href', 'target', 'tag', 'clickable'],
          template: '<a class="q-item" :href="href" :target="target"><slot /></a>',
        },
        QItemSection: {
          name: 'QItemSection',
          props: ['avatar'],
          template: '<div class="q-item-section"><slot /></div>',
        },
        QItemLabel: {
          name: 'QItemLabel',
          props: ['caption'],
          template: '<span class="q-item-label"><slot /></span>',
        },
        QIcon: {
          name: 'QIcon',
          props: ['name'],
          template: '<i class="q-icon">{{ name }}</i>',
        },
      },
    },
  });

describe('EssentialLink', () => {
  it('renders the provided title, caption, link, and icon', () => {
    const wrapper = mountComponent({
      caption: 'Helpful resources',
      link: 'https://example.com/docs',
      icon: 'school',
    });

    expect(wrapper.find('a.q-item').attributes('href')).toBe('https://example.com/docs');
    expect(wrapper.find('a.q-item').attributes('target')).toBe('_blank');
    expect(wrapper.text()).toContain('Read the docs');
    expect(wrapper.text()).toContain('Helpful resources');
    expect(wrapper.find('.q-icon').text()).toBe('school');
  });

  it('uses the default optional props when they are omitted', () => {
    const wrapper = mountComponent();
    const labels = wrapper.findAll('.q-item-label');

    expect(wrapper.find('a.q-item').attributes('href')).toBe('#');
    expect(wrapper.find('.q-icon').exists()).toBe(false);
    expect(labels).toHaveLength(2);
    expect(labels[1]?.text()).toBe('');
  });
});
