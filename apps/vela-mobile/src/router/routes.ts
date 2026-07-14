import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/MobileLayout.vue'),
    children: [
      {
        path: '',
        name: 'home',
        component: () => import('pages/HomePage.vue'),
      },
      {
        path: 'review',
        name: 'review',
        component: () => import('pages/ReviewPage.vue'),
      },
      {
        path: 'learn',
        name: 'learn',
        component: () => import('pages/LearnPage.vue'),
      },
      {
        path: 'words',
        name: 'words',
        component: () => import('pages/WordsPage.vue'),
      },
      {
        path: 'more',
        name: 'more',
        component: () => import('pages/MorePage.vue'),
      },
    ],
  },
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
