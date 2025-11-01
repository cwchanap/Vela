import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar } from 'quasar';
import AuthForm from './AuthForm.vue';
import { useAuthStore } from '../../stores/auth';

describe('AuthForm', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  const mountComponent = (props = {}) => {
    return mount(AuthForm, {
      global: {
        plugins: [Quasar],
      },
      props,
    });
  };

  describe('Initial Rendering', () => {
    it('should render in sign-in mode by default', () => {
      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Welcome Back');
      expect(wrapper.text()).toContain('Sign in to continue your journey');
    });

    it('should render in sign-up mode when mode prop is signup', () => {
      const wrapper = mountComponent({ mode: 'signup' });

      expect(wrapper.text()).toContain('Create Account');
      expect(wrapper.text()).toContain('Join us to start learning Japanese');
    });

    it('should show email and password input fields', () => {
      const wrapper = mountComponent();

      const inputs = wrapper.findAllComponents({ name: 'QInput' });
      expect(inputs.length).toBeGreaterThanOrEqual(2);

      const emailInput = inputs.find((input) => input.props('label') === 'Email');
      const passwordInput = inputs.find((input) => input.props('label')?.includes('Password'));

      expect(emailInput?.exists()).toBe(true);
      expect(passwordInput?.exists()).toBe(true);
    });

    it('should show username field only in sign-up mode', () => {
      const signInWrapper = mountComponent({ mode: 'signin' });
      const signUpWrapper = mountComponent({ mode: 'signup' });

      expect(signInWrapper.text()).not.toContain('Username');
      expect(signUpWrapper.text()).toContain('Username');
    });

    it('should show forgot password link only in sign-in mode', () => {
      const signInWrapper = mountComponent({ mode: 'signin' });
      const signUpWrapper = mountComponent({ mode: 'signup' });

      expect(signInWrapper.text()).toContain('Forgot Password?');
      expect(signUpWrapper.text()).not.toContain('Forgot Password?');
    });

    it('should have a form element', () => {
      const wrapper = mountComponent();

      expect(wrapper.find('form').exists()).toBe(true);
    });
  });

  describe('Form Buttons', () => {
    it('should have a submit button with correct text in sign-in mode', () => {
      const wrapper = mountComponent({ mode: 'signin' });

      const submitButton = wrapper.findAllComponents({ name: 'QBtn' }).find((btn) => {
        return btn.props('type') === 'submit';
      });

      expect(submitButton?.exists()).toBe(true);
      expect(submitButton?.text()).toContain('Sign In');
    });

    it('should have a submit button with correct text in sign-up mode', () => {
      const wrapper = mountComponent({ mode: 'signup' });

      const submitButton = wrapper.findAllComponents({ name: 'QBtn' }).find((btn) => {
        return btn.props('type') === 'submit';
      });

      expect(submitButton?.exists()).toBe(true);
      expect(submitButton?.text()).toContain('Create Account');
    });

    it('should have a mode toggle button in sign-in mode', () => {
      const wrapper = mountComponent({ mode: 'signin' });

      const toggleButton = wrapper.findAllComponents({ name: 'QBtn' }).find((btn) => {
        return btn.text() === 'Sign Up';
      });

      expect(toggleButton?.exists()).toBe(true);
    });

    it('should have a mode toggle button in sign-up mode', () => {
      const wrapper = mountComponent({ mode: 'signup' });

      const toggleButton = wrapper.findAllComponents({ name: 'QBtn' }).find((btn) => {
        return btn.text() === 'Sign In';
      });

      expect(toggleButton?.exists()).toBe(true);
    });
  });

  describe('Form Validation', () => {
    it('should have validation rules on email input', () => {
      const wrapper = mountComponent();

      const emailInput = wrapper.findAllComponents({ name: 'QInput' }).find((input) => {
        return input.props('label') === 'Email';
      });

      expect(emailInput?.props('rules')).toBeDefined();
      expect(Array.isArray(emailInput?.props('rules'))).toBe(true);
    });

    it('should have validation rules on password input', () => {
      const wrapper = mountComponent();

      const passwordInput = wrapper.findAllComponents({ name: 'QInput' }).find((input) => {
        return input.props('label')?.includes('Password');
      });

      expect(passwordInput?.props('rules')).toBeDefined();
      expect(Array.isArray(passwordInput?.props('rules'))).toBe(true);
    });
  });

  describe('Input Configuration', () => {
    it('should have email input with correct label', () => {
      const wrapper = mountComponent();

      const emailInput = wrapper.findAllComponents({ name: 'QInput' }).find((input) => {
        return input.props('label') === 'Email';
      });

      expect(emailInput?.exists()).toBe(true);
    });

    it('should have password type on password input', () => {
      const wrapper = mountComponent();

      const passwordInput = wrapper.findAllComponents({ name: 'QInput' }).find((input) => {
        return input.props('label')?.includes('Password');
      });

      expect(passwordInput?.props('type')).toBe('password');
    });
  });

  describe('Error Display', () => {
    it('should display error banner when auth store has error', async () => {
      const authStore = useAuthStore();
      authStore.setError('Authentication failed');

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      const banner = wrapper.findComponent({ name: 'QBanner' });
      expect(banner.exists()).toBe(true);
      expect(wrapper.text()).toContain('Authentication failed');
    });

    it('should not display error banner when no error exists', () => {
      const wrapper = mountComponent();

      const banner = wrapper.findComponent({ name: 'QBanner' });
      expect(banner.exists()).toBe(false);
    });

    it('should show error icon in banner', async () => {
      const authStore = useAuthStore();
      authStore.setError('Test error');

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      const banner = wrapper.findComponent({ name: 'QBanner' });
      const icons = banner.findAllComponents({ name: 'QIcon' });

      expect(icons.length).toBeGreaterThan(0);
    });
  });

  describe('Loading States', () => {
    it('should disable inputs when auth store is loading', async () => {
      const authStore = useAuthStore();
      authStore.isLoading = true;

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      const inputs = wrapper.findAllComponents({ name: 'QInput' });
      inputs.forEach((input) => {
        expect(input.props('disable')).toBe(true);
      });
    });

    it('should show loading state on submit button when auth store is loading', async () => {
      const authStore = useAuthStore();
      authStore.isLoading = true;

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      const submitButton = wrapper.findAllComponents({ name: 'QBtn' }).find((btn) => {
        return btn.props('type') === 'submit';
      });

      expect(submitButton?.props('loading')).toBe(true);
    });

    it('should disable toggle button when loading', async () => {
      const authStore = useAuthStore();
      authStore.isLoading = true;

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      const toggleButton = wrapper.findAllComponents({ name: 'QBtn' }).find((btn) => {
        return btn.text() === 'Sign Up';
      });

      expect(toggleButton?.props('disable')).toBe(true);
    });

    it('should disable submit button when loading', async () => {
      const authStore = useAuthStore();
      authStore.isLoading = true;

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      const submitButton = wrapper.findAllComponents({ name: 'QBtn' }).find((btn) => {
        return btn.props('type') === 'submit';
      });

      expect(submitButton?.props('disable')).toBe(true);
    });
  });

  describe('Props', () => {
    it('should accept mode prop', () => {
      const signInWrapper = mountComponent({ mode: 'signin' });
      const signUpWrapper = mountComponent({ mode: 'signup' });

      expect(signInWrapper.props('mode')).toBe('signin');
      expect(signUpWrapper.props('mode')).toBe('signup');
    });

    it('should accept redirectTo prop', () => {
      const wrapper = mountComponent({ redirectTo: '/dashboard' });

      expect(wrapper.props('redirectTo')).toBe('/dashboard');
    });

    it('should have default redirectTo value', () => {
      const wrapper = mountComponent();

      expect(wrapper.props('redirectTo')).toBe('/');
    });
  });

  describe('Store Integration', () => {
    it('should have access to auth store', () => {
      mountComponent();

      const authStore = useAuthStore();
      expect(authStore).toBeDefined();
      expect(typeof authStore.signIn).toBe('function');
      expect(typeof authStore.signUp).toBe('function');
    });

    it('should have signIn method in store', () => {
      const authStore = useAuthStore();

      expect(typeof authStore.signIn).toBe('function');
    });

    it('should have signUp method in store', () => {
      const authStore = useAuthStore();

      expect(typeof authStore.signUp).toBe('function');
    });

    it('should have resetPassword method in store', () => {
      const authStore = useAuthStore();

      expect(typeof authStore.resetPassword).toBe('function');
    });

    it('should have setError method in store', () => {
      const authStore = useAuthStore();

      expect(typeof authStore.setError).toBe('function');
    });
  });

  describe('Forgot Password Dialog', () => {
    it('should have forgot password button in sign-in mode', () => {
      const wrapper = mountComponent({ mode: 'signin' });

      const forgotButton = wrapper.findAllComponents({ name: 'QBtn' }).find((btn) => {
        return btn.text().includes('Forgot Password?');
      });

      expect(forgotButton?.exists()).toBe(true);
    });

    it('should have a dialog component for forgot password', () => {
      const wrapper = mountComponent({ mode: 'signin' });

      const dialog = wrapper.findComponent({ name: 'QDialog' });
      expect(dialog.exists()).toBe(true);
    });
  });

  describe('UI Elements', () => {
    it('should have form element', () => {
      const wrapper = mountComponent();

      const form = wrapper.find('form');
      expect(form.exists()).toBe(true);
    });

    it('should show sign-in related icons', () => {
      const wrapper = mountComponent();

      const icons = wrapper.findAllComponents({ name: 'QIcon' });
      expect(icons.length).toBeGreaterThan(0);
    });

    it('should have input components', () => {
      const wrapper = mountComponent();

      const inputs = wrapper.findAllComponents({ name: 'QInput' });
      expect(inputs.length).toBeGreaterThan(0);
    });
  });
});
