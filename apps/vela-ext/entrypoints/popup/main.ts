import { createApp } from 'vue';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { createQueryClient } from '@vela/common';
import './style.css';
import App from './App.vue';

// Create a QueryClient instance with shared configuration
const queryClient = createQueryClient();

const app = createApp(App);

// Install Vue Query plugin
app.use(VueQueryPlugin, {
  queryClient,
});

app.mount('#app');
