import { createApp } from 'vue';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import './style.css';
import App from './App.vue';

// Create a QueryClient instance with default options
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: false,
      refetchOnMount: true,
    },
    mutations: {
      retry: 1,
    },
  },
});

const app = createApp(App);

// Install Vue Query plugin
app.use(VueQueryPlugin, {
  queryClient,
});

app.mount('#app');
