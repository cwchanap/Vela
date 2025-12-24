// Consolidated navigation - Duolingo-inspired simplicity
// Icons use Quasar's default Material Icons set (name strings like 'home', 'chat')

export type RouteNavigationItem = {
  type: 'route';
  name: string;
  icon: string;
  path: string;
  requiresAuth?: boolean;
};

export type ActionNavigationItem = {
  type: 'action';
  name: string;
  icon: string;
  action: 'logout';
};

export type NavigationItem = RouteNavigationItem | ActionNavigationItem;

export const mainNavigation = [
  {
    type: 'route',
    name: 'Home',
    icon: 'home',
    path: '/',
    requiresAuth: true,
  },
  {
    type: 'route',
    name: 'Learn',
    icon: 'school',
    path: '/games',
    requiresAuth: true,
  },
  {
    type: 'route',
    name: 'Chat',
    icon: 'chat',
    path: '/chat',
    requiresAuth: true,
  },
  {
    type: 'route',
    name: 'Progress',
    icon: 'bar_chart',
    path: '/progress',
    requiresAuth: true,
  },
  {
    type: 'route',
    name: 'My Words',
    icon: 'bookmark',
    path: '/my-dictionaries',
    requiresAuth: true,
  },
] satisfies RouteNavigationItem[];

export const userNavigation = [
  {
    type: 'route',
    name: 'Profile',
    icon: 'person',
    path: '/profile',
  },
  {
    type: 'route',
    name: 'Settings',
    icon: 'settings',
    path: '/settings',
  },
  {
    type: 'action',
    name: 'Logout',
    icon: 'logout',
    action: 'logout',
  },
] satisfies NavigationItem[];
