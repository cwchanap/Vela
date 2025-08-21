declare module '@cloudflare/vite-plugin' {
  import type { PluginOption } from 'vite';
  export function cloudflare(options?: Record<string, unknown>): PluginOption;
}
