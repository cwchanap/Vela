// Consolidated navigation - Duolingo-inspired simplicity
export const mainNavigation = [
  {
    name: 'Home',
    icon: 'home',
    path: '/',
    requiresAuth: true,
  },
  {
    name: 'Learn',
    icon: 'school',
    path: '/games',
    requiresAuth: true,
  },
  {
    name: 'Chat',
    icon: 'chat',
    path: '/chat',
    requiresAuth: true,
  },
  {
    name: 'Progress',
    icon: 'bar_chart',
    path: '/progress',
    requiresAuth: true,
  },
  {
    name: 'My Words',
    icon: 'bookmark',
    path: '/my-dictionaries',
    requiresAuth: true,
  },
];

export const userNavigation = [
  {
    name: 'Profile',
    icon: 'person',
    path: '/profile',
  },
  {
    name: 'Settings',
    icon: 'settings',
    path: '/settings',
  },
  {
    name: 'Logout',
    icon: 'logout',
    path: '/logout',
  },
];
