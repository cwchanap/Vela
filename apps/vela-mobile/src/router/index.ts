import { defineRouter } from '#q-app';
import { createRouter, createWebHistory, type RouterScrollBehavior } from 'vue-router';
import routes from './routes';

export const mobileScrollBehavior: RouterScrollBehavior = (_to, _from, savedPosition) =>
  savedPosition ?? { left: 0, top: 0 };

export default defineRouter(() => {
  const Router = createRouter({
    scrollBehavior: mobileScrollBehavior,
    routes,
    // Quasar injects build.vueRouterBase into the client bundle.
    history: createWebHistory(import.meta.env.QUASAR_VUE_ROUTER_BASE),
  });

  return Router;
});
