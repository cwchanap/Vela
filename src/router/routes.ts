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
        meta: { requiresAuth: true },
      },
      {
        path: 'chat',
        name: 'ai-chat',
        component: () => import('pages/chat/AIChatPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('pages/settings/SettingsPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'progress',
        name: 'progress',
        component: () => import('pages/progress/ProgressPage.vue'),
        meta: { requiresAuth: true },
      },
      // Legacy child redirect: '/dashboard' -> '/'
      {
        path: 'dashboard',
        redirect: { name: 'home' },
      },
    ],
  },

  // Authentication routes
  {
    path: '/auth',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      {
        path: 'login',
        name: 'login',
        component: () => import('pages/auth/LoginPage.vue'),
        meta: { requiresGuest: true },
      },
      {
        path: 'signup',
        name: 'signup',
        component: () => import('pages/auth/LoginPage.vue'),
        meta: { requiresGuest: true },
      },
      {
        path: 'profile',
        name: 'profile',
        component: () => import('pages/auth/ProfilePage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'callback',
        name: 'auth-callback',
        component: () => import('pages/auth/LoginPage.vue'),
      },
      {
        path: 'reset-password',
        name: 'reset-password',
        component: () => import('pages/auth/LoginPage.vue'),
      },
    ],
  },

  // Game routes
  {
    path: '/games',
    component: () => import('layouts/MainLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'games',
        component: () => import('pages/games/GamesIndex.vue'),
      },
      {
        path: 'vocabulary',
        name: 'vocabulary-game',
        component: () => import('pages/games/VocabularyGame.vue'),
      },
      {
        path: 'sentence',
        name: 'sentence-game',
        component: () => import('pages/games/SentenceGame.vue'),
      },
      // {
      //   path: 'results',
      //   name: 'game-results',
      //   component: () => import('pages/games/GameResults.vue'),
      // },
    ],
  },

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

  // Dev utilities (removed LLM test page)

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
