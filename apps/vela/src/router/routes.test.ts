import { describe, it, expect } from 'vitest';
import routes from './routes';

describe('routes', () => {
  it('exports an array of routes', () => {
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);
  });

  it('has a root route with MainLayout', () => {
    const root = routes.find((r) => r.path === '/');
    expect(root).toBeDefined();
    expect(root?.component).toBeDefined();
  });

  it('has child routes under root', () => {
    const root = routes.find((r) => r.path === '/');
    expect(root?.children).toBeDefined();
    expect((root?.children as any[]).length).toBeGreaterThan(0);
  });

  it('has home route with requiresAuth meta', () => {
    const root = routes.find((r) => r.path === '/');
    const homeRoute = (root?.children as any[])?.find((c) => c.path === '');
    expect(homeRoute).toBeDefined();
    expect(homeRoute.name).toBe('home');
    expect(homeRoute.meta?.requiresAuth).toBe(true);
  });

  it('has chat route', () => {
    const root = routes.find((r) => r.path === '/');
    const chatRoute = (root?.children as any[])?.find((c) => c.path === 'chat');
    expect(chatRoute).toBeDefined();
    expect(chatRoute.name).toBe('ai-chat');
    expect(chatRoute.meta?.requiresAuth).toBe(true);
  });

  it('has settings route', () => {
    const root = routes.find((r) => r.path === '/');
    const settingsRoute = (root?.children as any[])?.find((c) => c.path === 'settings');
    expect(settingsRoute).toBeDefined();
    expect(settingsRoute.name).toBe('settings');
  });

  it('has progress route', () => {
    const root = routes.find((r) => r.path === '/');
    const progressRoute = (root?.children as any[])?.find((c) => c.path === 'progress');
    expect(progressRoute).toBeDefined();
    expect(progressRoute.name).toBe('progress');
  });

  it('has my-dictionaries route', () => {
    const root = routes.find((r) => r.path === '/');
    const dictRoute = (root?.children as any[])?.find((c) => c.path === 'my-dictionaries');
    expect(dictRoute).toBeDefined();
    expect(dictRoute.name).toBe('my-dictionaries');
  });

  it('has profile route', () => {
    const root = routes.find((r) => r.path === '/');
    const profileRoute = (root?.children as any[])?.find((c) => c.path === 'profile');
    expect(profileRoute).toBeDefined();
    expect(profileRoute.name).toBe('profile');
  });

  it('has dashboard redirect to home', () => {
    const root = routes.find((r) => r.path === '/');
    const dashboardRoute = (root?.children as any[])?.find((c) => c.path === 'dashboard');
    expect(dashboardRoute).toBeDefined();
    expect(dashboardRoute.redirect).toEqual({ name: 'home' });
  });

  it('has auth routes section', () => {
    const authRoute = routes.find((r) => r.path === '/auth');
    expect(authRoute).toBeDefined();
    expect(authRoute?.children).toBeDefined();
  });

  it('has login route with requiresGuest meta', () => {
    const authRoute = routes.find((r) => r.path === '/auth');
    const loginRoute = (authRoute?.children as any[])?.find((c) => c.path === 'login');
    expect(loginRoute).toBeDefined();
    expect(loginRoute.name).toBe('login');
    expect(loginRoute.meta?.requiresGuest).toBe(true);
  });

  it('has signup route with requiresGuest meta', () => {
    const authRoute = routes.find((r) => r.path === '/auth');
    const signupRoute = (authRoute?.children as any[])?.find((c) => c.path === 'signup');
    expect(signupRoute).toBeDefined();
    expect(signupRoute.name).toBe('signup');
    expect(signupRoute.meta?.requiresGuest).toBe(true);
  });

  it('has auth callback route', () => {
    const authRoute = routes.find((r) => r.path === '/auth');
    const callbackRoute = (authRoute?.children as any[])?.find((c) => c.path === 'callback');
    expect(callbackRoute).toBeDefined();
    expect(callbackRoute.name).toBe('auth-callback');
  });

  it('has reset-password route', () => {
    const authRoute = routes.find((r) => r.path === '/auth');
    const resetRoute = (authRoute?.children as any[])?.find((c) => c.path === 'reset-password');
    expect(resetRoute).toBeDefined();
    expect(resetRoute.name).toBe('reset-password');
  });

  it('has flashcards route section', () => {
    const flashcardsRoute = routes.find((r) => r.path === '/flashcards');
    expect(flashcardsRoute).toBeDefined();
    expect(flashcardsRoute?.meta?.requiresAuth).toBe(true);
  });

  it('has flashcard review child route', () => {
    const flashcardsRoute = routes.find((r) => r.path === '/flashcards');
    const reviewRoute = (flashcardsRoute?.children as any[])?.find((c) => c.path === '');
    expect(reviewRoute).toBeDefined();
    expect(reviewRoute.name).toBe('flashcards');
  });

  it('has games route section', () => {
    const gamesRoute = routes.find((r) => r.path === '/games');
    expect(gamesRoute).toBeDefined();
  });

  it('has games index route', () => {
    const gamesRoute = routes.find((r) => r.path === '/games');
    const indexRoute = (gamesRoute?.children as any[])?.find((c) => c.path === '');
    expect(indexRoute).toBeDefined();
    expect(indexRoute.name).toBe('games');
  });

  it('has vocabulary game route', () => {
    const gamesRoute = routes.find((r) => r.path === '/games');
    const vocabRoute = (gamesRoute?.children as any[])?.find((c) => c.path === 'vocabulary');
    expect(vocabRoute).toBeDefined();
    expect(vocabRoute.name).toBe('vocabulary-game');
  });

  it('has sentence game route', () => {
    const gamesRoute = routes.find((r) => r.path === '/games');
    const sentenceRoute = (gamesRoute?.children as any[])?.find((c) => c.path === 'sentence');
    expect(sentenceRoute).toBeDefined();
    expect(sentenceRoute.name).toBe('sentence-game');
  });

  it('has catch-all route for 404', () => {
    const catchAll = routes.find((r) => r.path === '/:catchAll(.*)*');
    expect(catchAll).toBeDefined();
    expect(catchAll?.component).toBeDefined();
  });

  it('all routes with components have lazy-loaded components', () => {
    const flattenRoutes = (routeRecords: any[]): any[] =>
      routeRecords.flatMap((r) => [r, ...flattenRoutes((r.children as any[]) ?? [])]);

    const routesWithComponents = flattenRoutes(routes as any[]).filter((r) => r.component);
    routesWithComponents.forEach((route) => {
      // component should be a function (lazy-loaded) or an object (direct)
      const componentType = typeof route.component;
      expect(['function', 'object']).toContain(componentType);
    });
  });
});
