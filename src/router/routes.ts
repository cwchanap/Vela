import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      {
        path: '',
        name: 'home',
        component: () => import('pages/IndexPage.vue'),
      },
    ],
  },

  // Authentication routes (will be implemented in future tasks)
  // {
  //   path: '/auth',
  //   component: () => import('layouts/AuthLayout.vue'),
  //   children: [
  //     {
  //       path: 'login',
  //       name: 'login',
  //       component: () => import('pages/auth/LoginPage.vue'),
  //     },
  //     {
  //       path: 'profile',
  //       name: 'profile',
  //       component: () => import('pages/auth/ProfilePage.vue'),
  //       meta: { requiresAuth: true },
  //     },
  //   ],
  // },

  // Game routes with lazy loading (will be implemented in future tasks)
  // {
  //   path: '/games',
  //   component: () => import('layouts/MainLayout.vue'),
  //   meta: { requiresAuth: true },
  //   children: [
  //     {
  //       path: 'vocabulary',
  //       name: 'vocabulary-game',
  //       component: () => import('pages/games/VocabularyGame.vue'),
  //     },
  //     {
  //       path: 'sentence',
  //       name: 'sentence-game',
  //       component: () => import('pages/games/SentenceGame.vue'),
  //     },
  //     {
  //       path: 'results',
  //       name: 'game-results',
  //       component: () => import('pages/games/GameResults.vue'),
  //     },
  //   ],
  // },

  // Chat route (will be implemented in future tasks)
  // {
  //   path: '/chat',
  //   name: 'ai-chat',
  //   component: () => import('layouts/MainLayout.vue'),
  //   meta: { requiresAuth: true },
  //   children: [
  //     {
  //       path: '',
  //       component: () => import('pages/chat/AIChatPage.vue'),
  //     },
  //   ],
  // },

  // Progress route (will be implemented in future tasks)
  // {
  //   path: '/progress',
  //   name: 'progress',
  //   component: () => import('layouts/MainLayout.vue'),
  //   meta: { requiresAuth: true },
  //   children: [
  //     {
  //       path: '',
  //       component: () => import('pages/progress/ProgressPage.vue'),
  //     },
  //   ],
  // },

  // Dashboard route (will be implemented in future tasks)
  // {
  //   path: '/dashboard',
  //   name: 'dashboard',
  //   component: () => import('layouts/MainLayout.vue'),
  //   meta: { requiresAuth: true },
  //   children: [
  //     {
  //       path: '',
  //       component: () => import('pages/DashboardPage.vue'),
  //     },
  //   ],
  // },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
