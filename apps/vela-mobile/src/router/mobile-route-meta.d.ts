import type { RouteLocationRaw } from 'vue-router';

declare module 'vue-router' {
  interface RouteMeta {
    mobileHeader?: {
      title: string;
      fallback: RouteLocationRaw;
    };
  }
}

export {};
