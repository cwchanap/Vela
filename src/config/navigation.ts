export const mainNavigation = [
  {
    name: 'Dashboard',
    icon: 'fas fa-tachometer-alt',
    path: '/dashboard',
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
    path: '/games/vocabulary',
    requiresAuth: true,
  },
  {
    name: 'Chat',
    icon: 'fas fa-comments',
    path: '/chat',
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
