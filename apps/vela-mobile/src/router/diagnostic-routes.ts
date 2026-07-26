import type { RouteRecordRaw } from 'vue-router';
import {
  IOS_DIAGNOSTIC_DETAIL_PATH,
  IOS_DIAGNOSTIC_ROOT_PATH,
  IOS_INTERACTION_DIAGNOSTICS_LABEL,
} from 'src/diagnostics/ios-interaction-contract';

const coreRoutes: RouteRecordRaw[] = [
  { path: '', name: 'home', component: () => import('pages/HomePage.vue') },
  { path: 'review', name: 'review', component: () => import('pages/ReviewPage.vue') },
  { path: 'learn', name: 'learn', component: () => import('pages/LearnPage.vue') },
  { path: 'words', name: 'words', component: () => import('pages/WordsPage.vue') },
  { path: 'more', name: 'more', component: () => import('pages/MorePage.vue') },
];

export const developmentDiagnosticRoutes: RouteRecordRaw[] = import.meta.env.DEV
  ? [
      {
        path: IOS_DIAGNOSTIC_ROOT_PATH.slice(1),
        name: 'iosInteractionDiagnostics',
        component: () => import('pages/diagnostics/IosInteractionDiagnosticsPage.vue'),
        meta: {
          mobileHeader: {
            title: IOS_INTERACTION_DIAGNOSTICS_LABEL,
            fallback: '/more',
          },
        },
      },
      {
        path: IOS_DIAGNOSTIC_DETAIL_PATH.slice(1),
        name: 'ios-interaction-detail',
        component: () => import('pages/diagnostics/IosInteractionDetailPage.vue'),
        meta: {
          mobileHeader: {
            title: 'Navigation Detail',
            fallback: IOS_DIAGNOSTIC_ROOT_PATH,
          },
        },
      },
    ]
  : [];

export function buildMobileChildRoutes(
  diagnosticRoutes: RouteRecordRaw[] = developmentDiagnosticRoutes,
): RouteRecordRaw[] {
  return [...coreRoutes, ...diagnosticRoutes];
}
