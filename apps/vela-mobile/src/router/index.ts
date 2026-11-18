import { defineRouter } from '#q-app';
import {
  createMemoryHistory,
  createRouter,
  createWebHashHistory,
  createWebHistory,
  type RouterScrollBehavior,
} from 'vue-router';
import routes from './routes';

export const mobileScrollBehavior: RouterScrollBehavior = (_to, _from, savedPosition) =>
  savedPosition ?? { left: 0, top: 0 };

export default defineRouter(() => {
  // Quasar forces vueRouterMode 'hash' for Capacitor builds, where HTML5
  // history navigation is unreliable on the capacitor:// origin.
  const createHistory = import.meta.env.QUASAR_SERVER
    ? createMemoryHistory
    : import.meta.env.QUASAR_VUE_ROUTER_MODE === 'history'
      ? createWebHistory
      : createWebHashHistory;

  const Router = createRouter({
    scrollBehavior: mobileScrollBehavior,
    routes,
    // Quasar injects build.vueRouterBase into the client bundle.
    history: createHistory(import.meta.env.QUASAR_VUE_ROUTER_BASE),
  });

  return Router;
});
