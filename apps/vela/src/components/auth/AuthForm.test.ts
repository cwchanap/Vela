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

  it('renders the Google-only auth entry surface for sign-in mode', () => {
    const wrapper = mountComponent({ mode: 'signin' });

    expect(wrapper.text()).toContain('Welcome to Vela');
    expect(wrapper.text()).toContain('Continue with Google to start learning Japanese');
    expect(wrapper.text()).toContain('Continue with Google');
  });

  it('keeps signup mode compatible while rendering the same Google-only surface', () => {
    const wrapper = mountComponent({ mode: 'signup' });

    expect(wrapper.props('mode')).toBe('signup');
    expect(wrapper.text()).toContain('Welcome to Vela');
    expect(wrapper.text()).toContain('Continue with Google');
  });

  it('does not render credential, signup, or forgot-password controls', () => {
    const wrapper = mountComponent({ mode: 'signup' });

    expect(wrapper.findAllComponents({ name: 'QInput' })).toHaveLength(0);
    expect(wrapper.text()).not.toContain('Email');
    expect(wrapper.text()).not.toContain('Password');
    expect(wrapper.text()).not.toContain('Create Account');
    expect(wrapper.text()).not.toContain('Forgot Password');
    expect(wrapper.text()).not.toContain('Sign Up');
  });

  it('displays an error banner when auth store has an error', async () => {
    const authStore = useAuthStore();
    authStore.setError('Google sign-in failed');

    const wrapper = mountComponent();
    await wrapper.vm.$nextTick();

    const banner = wrapper.findComponent({ name: 'QBanner' });
    expect(banner.exists()).toBe(true);
    expect(wrapper.text()).toContain('Google sign-in failed');
  });

  it('does not display an error banner when no error exists', () => {
    const wrapper = mountComponent();

    expect(wrapper.findComponent({ name: 'QBanner' }).exists()).toBe(false);
  });

  it('clicking the Google button starts Google sign-in', async () => {
    const authStore = useAuthStore();
    const signInSpy = vi.spyOn(authStore, 'signInWithGoogle').mockResolvedValue(true);
    const wrapper = mountComponent();

    const button = wrapper
      .findAllComponents({ name: 'QBtn' })
      .find((btn) => btn.text().includes('Continue with Google'));
    await button!.trigger('click');

    expect(signInSpy).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('error')).toBeFalsy();
  });

  it('emits an error when Google sign-in fails with a store error', async () => {
    const authStore = useAuthStore();
    vi.spyOn(authStore, 'signInWithGoogle').mockImplementation(async () => {
      authStore.setError('Unable to start Google sign-in');
      return false;
    });
    const wrapper = mountComponent();

    const button = wrapper
      .findAllComponents({ name: 'QBtn' })
      .find((btn) => btn.text().includes('Continue with Google'));
    await button!.trigger('click');

    expect(wrapper.emitted('error')).toEqual([['Unable to start Google sign-in']]);
  });

  it('shows loading and disabled state on the Google button', async () => {
    const authStore = useAuthStore();
    authStore.isLoading = true;

    const wrapper = mountComponent();
    await wrapper.vm.$nextTick();

    const button = wrapper
      .findAllComponents({ name: 'QBtn' })
      .find((btn) => btn.text().includes('Continue with Google'));
    expect(button?.props('loading')).toBe(true);
    expect(button?.props('disable')).toBe(true);
  });

  it('accepts redirectTo prop for API stability', () => {
    const wrapper = mountComponent({ redirectTo: '/dashboard' });

    expect(wrapper.props('redirectTo')).toBe('/dashboard');
  });
});
