export const config = {
  app: {
    name: import.meta.env.VITE_APP_NAME || 'Vela',
    version: import.meta.env.VITE_APP_VERSION || '0.0.1',
    isDev: import.meta.env.DEV,
    isProd: import.meta.env.PROD,
  },
} as const;
