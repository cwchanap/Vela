export const mainNavigation = [
  {
    name: 'Home',
    icon: 'fas fa-tachometer-alt',
    path: '/',
    requiresAuth: true,
  },
  {
    name: 'Vocabulary',
    icon: 'fas fa-book',
    path: '/vocabulary',
    requiresAuth: true,
  },
  {
    name: 'Games',
    icon: 'fas fa-gamepad',
    path: '/games',
    requiresAuth: true,
  },
  {
    name: 'Chat',
    icon: 'fas fa-comments',
    path: '/chat',
    requiresAuth: true,
  },
  {
    name: 'Progress',
    icon: 'fas fa-chart-line',
    path: '/progress',
    requiresAuth: true,
  },
  {
    name: 'Saved Sentences',
    icon: 'fas fa-bookmark',
    path: '/saved-sentences',
    requiresAuth: true,
  },
];

export const userNavigation = [
  {
    name: 'Profile',
    icon: 'fas fa-user',
    path: '/auth/profile',
  },
  {
    name: 'Settings',
    icon: 'fas fa-cog',
    path: '/settings',
  },
  {
    name: 'Logout',
    icon: 'fas fa-sign-out-alt',
    path: '/logout',
  },
];
