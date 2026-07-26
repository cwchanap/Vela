import { defineRouter } from '#q-app/wrappers';
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
  const createHistory = process.env.SERVER
    ? createMemoryHistory
    : process.env.VUE_ROUTER_MODE === 'history'
      ? createWebHistory
      : createWebHashHistory;

  const Router = createRouter({
    scrollBehavior: mobileScrollBehavior,
    routes,
    history: createHistory(process.env.VUE_ROUTER_BASE),
  });

  return Router;
});
