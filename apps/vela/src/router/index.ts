import { defineRouter } from '#q-app';
import { createRouter, createWebHistory } from 'vue-router';
import routes from './routes';
import { useAuthStore } from '../stores/auth';

export default defineRouter(function (/* { store, ssrContext } */) {
  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,

    // Quasar injects build.vueRouterBase into the client bundle.
    history: createWebHistory(import.meta.env.QUASAR_VUE_ROUTER_BASE),
  });

  // Navigation guards for authentication
  Router.beforeEach(async (to, from, next) => {
    try {
      const authStore = useAuthStore();

      // Legacy path support: redirect old dashboard URL to home
      if (to.path === '/dashboard') {
        next({ name: 'home' });
        return;
      }

      // Initialize auth store if not already done
      if (!authStore.isInitialized) {
        await authStore.initialize();
      }

      const requiresAuth = to.matched.some((record) => record.meta.requiresAuth);
      const requiresGuest = to.matched.some((record) => record.meta.requiresGuest);

      if (requiresAuth && !authStore.isAuthenticated && !authStore.session?.user) {
        // Redirect to login with return URL
        next({
          name: 'login',
          query: { redirect: to.fullPath },
        });
      } else if (requiresGuest && authStore.session) {
        // Redirect users with valid session away from guest-only pages (even if profile hasn't loaded)
        next({ name: 'home' });
      } else {
        next();
      }
    } catch (error) {
      console.error('Router guard error:', error);
      // Allow navigation to continue in case of error
      next();
    }
  });

  return Router;
});
