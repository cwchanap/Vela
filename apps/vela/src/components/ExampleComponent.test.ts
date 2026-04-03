import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ExampleComponent from './ExampleComponent.vue';

describe('ExampleComponent', () => {
  it('renders todo data and increments the click counter when an item is clicked', async () => {
    const wrapper = mount(ExampleComponent, {
      props: {
        title: 'Todo list',
        todos: [
          { id: 1, content: 'Study kana' },
          { id: 2, content: 'Review grammar' },
        ],
        meta: { totalCount: 3 },
        active: true,
      },
    });

    expect(wrapper.text()).toContain('Todo list');
    expect(wrapper.text()).toContain('1 - Study kana');
    expect(wrapper.text()).toContain('2 - Review grammar');
    expect(wrapper.text()).toContain('Count: 2 / 3');
    expect(wrapper.text()).toContain('Active: yes');

    await wrapper.findAll('li')[0]!.trigger('click');

    expect(wrapper.text()).toContain('Clicks on todos: 1');
  });

  it('defaults todos to an empty list when none are provided', () => {
    const wrapper = mount(ExampleComponent, {
      props: {
        title: 'Empty todos',
        meta: { totalCount: 0 },
        active: false,
      },
    });

    expect(wrapper.findAll('li')).toHaveLength(0);
    expect(wrapper.text()).toContain('Count: 0 / 0');
    expect(wrapper.text()).toContain('Active: no');
    expect(wrapper.text()).toContain('Clicks on todos: 0');
  });
});
