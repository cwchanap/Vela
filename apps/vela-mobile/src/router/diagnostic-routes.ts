import type { RouteRecordRaw } from 'vue-router';
import {
  IOS_DIAGNOSTIC_DETAIL_PATH,
  IOS_DIAGNOSTIC_ROOT_PATH,
  IOS_INTERACTION_DIAGNOSTICS_LABEL,
} from 'src/diagnostics/ios-interaction-contract';
import {
  TTS_PRONUNCIATION_DIAGNOSTIC_LABEL,
  TTS_PRONUNCIATION_DIAGNOSTIC_PATH,
} from 'src/diagnostics/tts-pronunciation-contract';

const coreRoutes: RouteRecordRaw[] = [
  { path: '', name: 'home', component: () => import('pages/HomePage.vue') },
  { path: 'review', name: 'review', component: () => import('pages/ReviewPage.vue') },
  { path: 'learn', name: 'learn', component: () => import('pages/LearnPage.vue') },
  { path: 'words', name: 'words', component: () => import('pages/WordsPage.vue') },
  { path: 'more', name: 'more', component: () => import('pages/MorePage.vue') },
];

const TTS_PRONUNCIATION_DIAGNOSTICS_PAGE =
  '/src/pages/diagnostics/TtsPronunciationDiagnosticsPage.vue';

export const bypassDevelopmentDiagnosticRoutes: RouteRecordRaw[] = import.meta.env.DEV
  ? [
      {
        path: IOS_DIAGNOSTIC_ROOT_PATH.slice(1),
        name: 'iosInteractionDiagnostics',
        component: () => import('pages/diagnostics/IosInteractionDiagnosticsPage.vue'),
        meta: {
          bypassMobileAuth: true,
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
          bypassMobileAuth: true,
          mobileHeader: {
            title: 'Navigation Detail',
            fallback: IOS_DIAGNOSTIC_ROOT_PATH,
          },
        },
      },
    ]
  : [];

export const authenticatedDevelopmentDiagnosticRoutes: RouteRecordRaw[] = import.meta.env.DEV
  ? [
      {
        path: TTS_PRONUNCIATION_DIAGNOSTIC_PATH.slice(1),
        name: 'ttsPronunciationDiagnostics',
        component: () => import(/* @vite-ignore */ TTS_PRONUNCIATION_DIAGNOSTICS_PAGE),
        meta: {
          mobileHeader: {
            title: TTS_PRONUNCIATION_DIAGNOSTIC_LABEL,
            fallback: '/more',
          },
        },
      },
    ]
  : [];

export const developmentDiagnosticRoutes: RouteRecordRaw[] = [
  ...bypassDevelopmentDiagnosticRoutes,
  ...authenticatedDevelopmentDiagnosticRoutes,
];

export function buildMobileChildRoutes(
  diagnosticRoutes: RouteRecordRaw[] = developmentDiagnosticRoutes,
): RouteRecordRaw[] {
  return [...coreRoutes, ...diagnosticRoutes];
}
