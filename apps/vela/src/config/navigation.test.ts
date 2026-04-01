import { describe, it, expect } from 'vitest';
import { mainNavigation, userNavigation } from './navigation';
import type { RouteNavigationItem, ActionNavigationItem } from './navigation';

describe('mainNavigation', () => {
  it('contains expected number of items', () => {
    expect(mainNavigation).toHaveLength(6);
  });

  it('all items are route type', () => {
    for (const item of mainNavigation) {
      expect(item.type).toBe('route');
    }
  });

  it('all items require authentication', () => {
    for (const item of mainNavigation) {
      expect(item.requiresAuth).toBe(true);
    }
  });

  it('all items have non-empty name, icon, and path', () => {
    for (const item of mainNavigation) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.icon.length).toBeGreaterThan(0);
      expect(item.path.length).toBeGreaterThan(0);
    }
  });

  it('contains Home route at /', () => {
    const home = mainNavigation.find((item) => item.name === 'Home');
    expect(home).toBeDefined();
    expect(home?.path).toBe('/');
    expect(home?.icon).toBe('home');
  });

  it('contains Review route at /flashcards', () => {
    const review = mainNavigation.find((item) => item.name === 'Review');
    expect(review).toBeDefined();
    expect(review?.path).toBe('/flashcards');
  });

  it('contains Learn route at /games', () => {
    const learn = mainNavigation.find((item) => item.name === 'Learn');
    expect(learn).toBeDefined();
    expect(learn?.path).toBe('/games');
  });

  it('contains Chat route at /chat', () => {
    const chat = mainNavigation.find((item) => item.name === 'Chat');
    expect(chat).toBeDefined();
    expect(chat?.path).toBe('/chat');
  });

  it('contains Progress route at /progress', () => {
    const progress = mainNavigation.find((item) => item.name === 'Progress');
    expect(progress).toBeDefined();
    expect(progress?.path).toBe('/progress');
  });

  it('contains My Words route at /my-dictionaries', () => {
    const myWords = mainNavigation.find((item) => item.name === 'My Words');
    expect(myWords).toBeDefined();
    expect(myWords?.path).toBe('/my-dictionaries');
  });

  it('all paths start with /', () => {
    for (const item of mainNavigation) {
      expect(item.path).toMatch(/^\//);
    }
  });

  it('has unique paths', () => {
    const paths = mainNavigation.map((item) => item.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('has unique names', () => {
    const names = mainNavigation.map((item) => item.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('userNavigation', () => {
  it('contains expected number of items', () => {
    expect(userNavigation).toHaveLength(3);
  });

  it('contains Profile route', () => {
    const profile = userNavigation.find(
      (item): item is RouteNavigationItem => item.type === 'route' && item.name === 'Profile',
    );
    expect(profile).toBeDefined();
    expect(profile?.path).toBe('/profile');
    expect(profile?.icon).toBe('person');
  });

  it('contains Settings route', () => {
    const settings = userNavigation.find(
      (item): item is RouteNavigationItem => item.type === 'route' && item.name === 'Settings',
    );
    expect(settings).toBeDefined();
    expect(settings?.path).toBe('/settings');
    expect(settings?.icon).toBe('settings');
  });

  it('contains Logout action', () => {
    const logout = userNavigation.find(
      (item): item is ActionNavigationItem => item.type === 'action' && item.name === 'Logout',
    );
    expect(logout).toBeDefined();
    expect(logout?.action).toBe('logout');
    expect(logout?.icon).toBe('logout');
  });

  it('has at least one route type item', () => {
    const routes = userNavigation.filter((item) => item.type === 'route');
    expect(routes.length).toBeGreaterThan(0);
  });

  it('has at least one action type item', () => {
    const actions = userNavigation.filter((item) => item.type === 'action');
    expect(actions.length).toBeGreaterThan(0);
  });

  it('all items have non-empty name and icon', () => {
    for (const item of userNavigation) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('NavigationItem type guard behavior', () => {
  it('route items have path property', () => {
    const routeItems = [...mainNavigation, ...userNavigation].filter(
      (item): item is RouteNavigationItem => item.type === 'route',
    );
    for (const item of routeItems) {
      expect('path' in item).toBe(true);
    }
  });

  it('action items have action property', () => {
    const actionItems = userNavigation.filter(
      (item): item is ActionNavigationItem => item.type === 'action',
    );
    for (const item of actionItems) {
      expect('action' in item).toBe(true);
    }
  });
});
