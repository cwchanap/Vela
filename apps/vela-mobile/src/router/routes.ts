import type { RouteRecordRaw } from 'vue-router';
import { buildMobileChildRoutes } from './diagnostic-routes';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/MobileLayout.vue'),
    children: buildMobileChildRoutes(),
  },
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
