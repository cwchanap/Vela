import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import NavigationLink from './NavigationLink.vue';

// Mock useQuasar to return our spy
let notifyCreateSpy: ReturnType<typeof vi.fn>;

vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  return {
    ...actual,
    useQuasar: () => ({
      notify: notifyCreateSpy,
    }),
  };
});

describe('NavigationLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Create fresh spy for each test
    notifyCreateSpy = vi.fn();
  });

  const mountComponent = (props = {}) => {
    return mount(NavigationLink, {
      props: {
        title: 'Test Title',
        caption: 'Test caption',
        icon: 'home',
        ...props,
      },
      global: {
        plugins: [Quasar],
      },
    });
  };

  describe('enabled state rendering', () => {
    it('should render title and caption for enabled state', () => {
      const wrapper = mountComponent({
        title: 'My Feature',
        caption: 'This is a feature description',
        disabled: false,
      });

      expect(wrapper.text()).toContain('My Feature');
      expect(wrapper.text()).toContain('This is a feature description');
    });

    it('should not have disabled class when enabled', () => {
      const wrapper = mountComponent({ disabled: false });

      const qItem = wrapper.find('.navigation-link');
      expect(qItem.classes()).not.toContain('navigation-link--disabled');
    });
  });

  describe('disabled state rendering', () => {
    it('should apply disabled state styling when disabled is true', () => {
      const wrapper = mountComponent({ disabled: true });

      const qItem = wrapper.find('.navigation-link');
      expect(qItem.classes()).toContain('navigation-link--disabled');
    });

    it('should have disable prop on q-item when disabled', () => {
      const wrapper = mountComponent({ disabled: true });

      const qItem = wrapper.findComponent({ name: 'QItem' });
      expect(qItem.props('disable')).toBe(true);
    });

    it('should render the Soon chip when disabled', () => {
      const wrapper = mountComponent({ disabled: true });

      const chip = wrapper.findComponent({ name: 'QChip' });
      expect(chip.exists()).toBe(true);
      expect(chip.text()).toBe('Soon');
    });

    it('should not render the Soon chip when enabled', () => {
      const wrapper = mountComponent({ disabled: false });

      const chip = wrapper.findComponent({ name: 'QChip' });
      expect(chip.exists()).toBe(false);
    });
  });

  describe('click behavior when disabled', () => {
    it('should trigger Quasar notify with expected message when disabled', () => {
      const wrapper = mountComponent({
        title: 'Premium Features',
        disabled: true,
      });

      // Access and call the handleClick method directly
      // (In real usage, Quasar prevents clicks on disabled items, but we test the logic)
      const vm = wrapper.vm as any;
      vm.handleClick();

      expect(notifyCreateSpy).toHaveBeenCalledTimes(1);
      expect(notifyCreateSpy).toHaveBeenCalledWith({
        type: 'info',
        message: 'Premium Features is coming soon!',
        timeout: 2000,
      });
    });

    it('should NOT emit click event when disabled', () => {
      const wrapper = mountComponent({ disabled: true });

      // Call handleClick directly
      const vm = wrapper.vm as any;
      vm.handleClick();

      expect(wrapper.emitted('click')).toBeFalsy();
    });
  });

  describe('click behavior when enabled', () => {
    it('should emit click event when enabled link is clicked', async () => {
      const wrapper = mountComponent({ disabled: false });

      const qItem = wrapper.findComponent({ name: 'QItem' });
      await qItem.trigger('click');

      expect(wrapper.emitted('click')).toBeTruthy();
      expect(wrapper.emitted('click')).toHaveLength(1);
    });

    it('should NOT trigger Quasar notify when enabled link is clicked', async () => {
      const wrapper = mountComponent({ disabled: false });

      const qItem = wrapper.findComponent({ name: 'QItem' });
      await qItem.trigger('click');

      expect(notifyCreateSpy).not.toHaveBeenCalled();
    });
  });
});
