import type { RouteLocationRaw } from 'vue-router';

declare module 'vue-router' {
  interface RouteMeta {
    bypassMobileAuth?: boolean;
    mobileHeader?: {
      title: string;
      fallback: RouteLocationRaw;
    };
  }
}

export {};
