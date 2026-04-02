import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar } from 'quasar';
import AuthForm from './AuthForm.vue';
import { useAuthStore } from '../../stores/auth';

let notifySpy: ReturnType<typeof vi.fn>;

vi.mock('quasar', async () => {
  const actual = await vi.importActual<typeof import('quasar')>('quasar');
  return {
    ...actual,
    useQuasar: () => ({
      notify: notifySpy,
    }),
  };
});

describe('AuthForm', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    notifySpy = vi.fn();
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
    it('should show email icon in email input', () => {
      const wrapper = mountComponent();

      const emailInput = wrapper.findAllComponents({ name: 'QInput' }).find((input) => {
        return input.props('label') === 'Email';
      });

      expect(emailInput?.exists()).toBe(true);
      const emailIcon = emailInput?.findComponent({ name: 'QIcon' });
      expect(emailIcon?.props('name')).toBe('email');
    });

    it('should show lock icon in password input', () => {
      const wrapper = mountComponent();

      const passwordInput = wrapper.findAllComponents({ name: 'QInput' }).find((input) => {
        return input.props('label') === 'Password';
      });

      expect(passwordInput?.exists()).toBe(true);
      const lockIcon = passwordInput?.findComponent({ name: 'QIcon' });
      expect(lockIcon?.props('name')).toBe('lock');
    });

    it('should show password visibility toggle icon', () => {
      const wrapper = mountComponent();

      const passwordInput = wrapper.findAllComponents({ name: 'QInput' }).find((input) => {
        return input.props('label') === 'Password';
      });

      expect(passwordInput?.exists()).toBe(true);
      const visibilityIcon = passwordInput?.findAllComponents({ name: 'QIcon' }).find((icon) => {
        return icon.props('name') === 'visibility' || icon.props('name') === 'visibility_off';
      });
      expect(visibilityIcon?.exists()).toBe(true);
    });

    it('should have email input with correct type', () => {
      const wrapper = mountComponent();

      const emailInput = wrapper.findAllComponents({ name: 'QInput' }).find((input) => {
        return input.props('label') === 'Email';
      });

      expect(emailInput?.exists()).toBe(true);
      expect(emailInput?.props('type')).toBe('email');
    });

    it('should have password input with correct type', () => {
      const wrapper = mountComponent();

      const passwordInput = wrapper.findAllComponents({ name: 'QInput' }).find((input) => {
        return input.props('label') === 'Password';
      });

      expect(passwordInput?.exists()).toBe(true);
      expect(passwordInput?.props('type')).toBe('password');
    });

    it('should show person icon in username input when in sign-up mode', () => {
      const wrapper = mountComponent({ mode: 'signup' });

      const usernameInput = wrapper.findAllComponents({ name: 'QInput' }).find((input) => {
        return input.props('label') === 'Username (optional)';
      });

      expect(usernameInput?.exists()).toBe(true);
      const personIcon = usernameInput?.findComponent({ name: 'QIcon' });
      expect(personIcon?.props('name')).toBe('person');
    });
  });

  describe('Submit Behavior', () => {
    it('sign-in success: calls signIn with credentials, notifies and emits success', async () => {
      const wrapper = mountComponent({ mode: 'signin' });
      const authStore = useAuthStore();
      vi.spyOn(authStore, 'signIn').mockResolvedValue(true);

      const vm = wrapper.vm as any;
      vm.form.email = 'test@example.com';
      vm.form.password = 'password123';

      await vm.handleSubmit();
      await wrapper.vm.$nextTick();

      expect(authStore.signIn).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'positive', message: 'Welcome back!' }),
      );
      expect(wrapper.emitted('success')).toBeTruthy();
      expect(wrapper.emitted('success')![0]).toEqual(['signin']);
    });

    it('sign-up success: calls signUp with credentials, notifies and emits success', async () => {
      const wrapper = mountComponent({ mode: 'signup' });
      const authStore = useAuthStore();
      vi.spyOn(authStore, 'signUp').mockResolvedValue(true);

      const vm = wrapper.vm as any;
      vm.form.email = 'newuser@example.com';
      vm.form.password = 'password123';
      vm.form.username = 'testuser';

      await vm.handleSubmit();
      await wrapper.vm.$nextTick();

      expect(authStore.signUp).toHaveBeenCalledWith({
        email: 'newuser@example.com',
        password: 'password123',
        username: 'testuser',
      });
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'positive',
          message: expect.stringContaining('Account created'),
        }),
      );
      expect(wrapper.emitted('success')).toBeTruthy();
      expect(wrapper.emitted('success')![0]).toEqual(['signup']);
    });

    it('sign-up with blank username sends undefined to store', async () => {
      const wrapper = mountComponent({ mode: 'signup' });
      const authStore = useAuthStore();
      vi.spyOn(authStore, 'signUp').mockResolvedValue(true);

      const vm = wrapper.vm as any;
      vm.form.email = 'newuser@example.com';
      vm.form.password = 'password123';
      vm.form.username = '';

      await vm.handleSubmit();

      expect(authStore.signUp).toHaveBeenCalledWith({
        email: 'newuser@example.com',
        password: 'password123',
        username: undefined,
      });
    });

    it('failed sign-in emits error when store has an error message', async () => {
      const wrapper = mountComponent({ mode: 'signin' });
      const authStore = useAuthStore();
      vi.spyOn(authStore, 'signIn').mockImplementation(async () => {
        authStore.setError('Invalid credentials');
        return false;
      });

      const vm = wrapper.vm as any;
      vm.form.email = 'test@example.com';
      vm.form.password = 'wrongpassword';

      await vm.handleSubmit();
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('error')).toBeTruthy();
      expect(wrapper.emitted('error')![0]).toEqual(['Invalid credentials']);
    });

    it('failed sign-in does not emit success or notify', async () => {
      const wrapper = mountComponent({ mode: 'signin' });
      const authStore = useAuthStore();
      vi.spyOn(authStore, 'signIn').mockResolvedValue(false);

      const vm = wrapper.vm as any;
      vm.form.email = 'test@example.com';
      vm.form.password = 'password123';

      await vm.handleSubmit();

      expect(wrapper.emitted('success')).toBeFalsy();
      expect(wrapper.emitted('error')).toBeFalsy();
      expect(notifySpy).not.toHaveBeenCalled();
    });

    it('failed sign-up emits error when store has an error message', async () => {
      const wrapper = mountComponent({ mode: 'signup' });
      const authStore = useAuthStore();
      vi.spyOn(authStore, 'signUp').mockImplementation(async () => {
        authStore.setError('Email already in use');
        return false;
      });

      const vm = wrapper.vm as any;
      vm.form.email = 'existing@example.com';
      vm.form.password = 'password123';

      await vm.handleSubmit();
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('error')).toBeTruthy();
      expect(wrapper.emitted('error')![0]).toEqual(['Email already in use']);
    });
  });

  describe('Toggle Mode Behavior', () => {
    it('clicking toggle calls setError(null) to clear any existing error', async () => {
      const wrapper = mountComponent({ mode: 'signin' });
      const authStore = useAuthStore();
      authStore.setError('Some previous error');
      const setErrorSpy = vi.spyOn(authStore, 'setError');

      const toggleButton = wrapper
        .findAllComponents({ name: 'QBtn' })
        .find((btn) => btn.text() === 'Sign Up');
      await toggleButton!.trigger('click');

      expect(setErrorSpy).toHaveBeenCalledWith(null);
    });

    it('clicking toggle switches from sign-in to sign-up UI', async () => {
      const wrapper = mountComponent({ mode: 'signin' });
      expect(wrapper.text()).toContain('Welcome Back');

      const toggleButton = wrapper
        .findAllComponents({ name: 'QBtn' })
        .find((btn) => btn.text() === 'Sign Up');
      await toggleButton!.trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('Create Account');
    });

    it('clicking toggle switches from sign-up to sign-in UI', async () => {
      const wrapper = mountComponent({ mode: 'signup' });

      const toggleButton = wrapper
        .findAllComponents({ name: 'QBtn' })
        .find((btn) => btn.text() === 'Sign In');
      await toggleButton!.trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('Welcome Back');
    });
  });

  describe('Password Reset Flow', () => {
    it('returns early without calling resetPassword when email is empty', async () => {
      const wrapper = mountComponent({ mode: 'signin' });
      const authStore = useAuthStore();
      const resetPasswordSpy = vi.spyOn(authStore, 'resetPassword');

      const vm = wrapper.vm as any;
      vm.resetEmail = '';

      await vm.handlePasswordReset();

      expect(resetPasswordSpy).not.toHaveBeenCalled();
      expect(notifySpy).not.toHaveBeenCalled();
    });

    it('returns early without calling resetPassword when email is invalid', async () => {
      const wrapper = mountComponent({ mode: 'signin' });
      const authStore = useAuthStore();
      const resetPasswordSpy = vi.spyOn(authStore, 'resetPassword');

      const vm = wrapper.vm as any;
      vm.resetEmail = 'not-an-email';

      await vm.handlePasswordReset();

      expect(resetPasswordSpy).not.toHaveBeenCalled();
      expect(notifySpy).not.toHaveBeenCalled();
    });

    it('success: notifies positive, clears dialog and email state, resets loading', async () => {
      const wrapper = mountComponent({ mode: 'signin' });
      const authStore = useAuthStore();
      vi.spyOn(authStore, 'resetPassword').mockResolvedValue(true);

      const vm = wrapper.vm as any;
      vm.resetEmail = 'user@example.com';
      vm.showForgotPassword = true;

      await vm.handlePasswordReset();
      await wrapper.vm.$nextTick();

      expect(authStore.resetPassword).toHaveBeenCalledWith('user@example.com');
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'positive',
          message: expect.stringContaining('Password reset link sent'),
        }),
      );
      expect(vm.showForgotPassword).toBe(false);
      expect(vm.resetEmail).toBe('');
      expect(vm.resetLoading).toBe(false);
    });

    it('failure: notifies negative with the store error message', async () => {
      const wrapper = mountComponent({ mode: 'signin' });
      const authStore = useAuthStore();
      vi.spyOn(authStore, 'resetPassword').mockImplementation(async () => {
        authStore.setError('User not found');
        return false;
      });

      const vm = wrapper.vm as any;
      vm.resetEmail = 'unknown@example.com';

      await vm.handlePasswordReset();
      await wrapper.vm.$nextTick();

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'negative', message: 'User not found' }),
      );
      expect(vm.resetLoading).toBe(false);
    });

    it('resets resetLoading to false in finally even on unexpected failure', async () => {
      const wrapper = mountComponent({ mode: 'signin' });
      const authStore = useAuthStore();
      // The real store resolves false on handled failures; force a raw rejection
      // here so the component's finally-block cleanup is still verified.
      vi.spyOn(authStore, 'resetPassword').mockRejectedValue(new Error('Network error'));

      const vm = wrapper.vm as any;
      vm.resetEmail = 'user@example.com';

      await vm.handlePasswordReset().catch(() => {});

      expect(vm.resetLoading).toBe(false);
    });

    it('clicking Forgot Password? button opens the dialog', async () => {
      const wrapper = mountComponent({ mode: 'signin' });
      const vm = wrapper.vm as any;
      expect(vm.showForgotPassword).toBe(false);

      const forgotBtn = wrapper
        .findAllComponents({ name: 'QBtn' })
        .find((btn) => btn.text().includes('Forgot Password?'));
      await forgotBtn!.trigger('click');

      expect(vm.showForgotPassword).toBe(true);
    });
  });

  describe('Password Visibility Toggle', () => {
    it('clicking visibility icon toggles showPassword state', async () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.showPassword).toBe(false);

      const passwordInput = wrapper
        .findAllComponents({ name: 'QInput' })
        .find((input) => input.props('label') === 'Password');
      const visibilityIcon = passwordInput!
        .findAllComponents({ name: 'QIcon' })
        .find(
          (icon) => icon.props('name') === 'visibility' || icon.props('name') === 'visibility_off',
        );
      await visibilityIcon!.trigger('click');

      expect(vm.showPassword).toBe(true);
    });

    it('password input type changes to text when showPassword is true', async () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;
      vm.showPassword = true;
      await wrapper.vm.$nextTick();

      const passwordInput = wrapper
        .findAllComponents({ name: 'QInput' })
        .find((input) => input.props('label') === 'Password');
      expect(passwordInput!.props('type')).toBe('text');
    });
  });
});
