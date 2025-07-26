import { defineRouter } from '#q-app/wrappers';
import {
  createMemoryHistory,
  createRouter,
  createWebHashHistory,
  createWebHistory,
} from 'vue-router';
import routes from './routes';
import { useAuthStore } from '../stores/auth';

/*
 * If not building with SSR mode, you can
 * directly export the Router instantiation;
 *
 * The function below can be async too; either use
 * async/await or return a Promise which resolves
 * with the Router instance.
 */

export default defineRouter(function (/* { store, ssrContext } */) {
  const createHistory = process.env.SERVER
    ? createMemoryHistory
    : process.env.VUE_ROUTER_MODE === 'history'
      ? createWebHistory
      : createWebHashHistory;

  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,

    // Leave this as is and make changes in quasar.conf.js instead!
    // quasar.conf.js -> build -> vueRouterMode
    // quasar.conf.js -> build -> publicPath
    history: createHistory(process.env.VUE_ROUTER_BASE),
  });

  // Navigation guards for authentication
  Router.beforeEach(async (to, from, next) => {
    try {
      const authStore = useAuthStore();

      // Initialize auth store if not already done
      if (!authStore.isInitialized) {
        await authStore.initialize();
      }

      const requiresAuth = to.matched.some((record) => record.meta.requiresAuth);
      const requiresGuest = to.matched.some((record) => record.meta.requiresGuest);

      if (requiresAuth && !authStore.isAuthenticated) {
        // Redirect to login with return URL
        next({
          name: 'login',
          query: { redirect: to.fullPath },
        });
      } else if (requiresGuest && authStore.isAuthenticated) {
        // Redirect authenticated users away from guest-only pages
        next({ name: 'dashboard' });
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
