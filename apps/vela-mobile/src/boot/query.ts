import { createQueryClient } from '@vela/common';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { defineBoot } from '#q-app/wrappers';

export const mobileQueryClient = createQueryClient();

export default defineBoot(({ app }) => {
  app.use(VueQueryPlugin, { queryClient: mobileQueryClient });
});
