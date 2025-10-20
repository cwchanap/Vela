# @vela/common

Shared utilities and configuration for Vela apps.

## Purpose

This package provides shared code that can be used by both the Vela web app (`@vela/app`) and the browser extension (`@vela/ext`), including:

- **TanStack Query Configuration**: QueryClient factory and cache settings
- **Query Key Factories**: Hierarchical query keys for consistent cache management
- **Constants**: Shared timing and configuration values
- **Future**: Other shared utilities, types, and helpers as needed

## What's Included

### Query Client Configuration

```typescript
import { createQueryClient, QUERY_STALE_TIME, QUERY_GC_TIME } from '@vela/common';

const queryClient = createQueryClient();
```

**Cache Timing Constants:**

- `QUERY_STALE_TIME` - 5 minutes (data considered fresh)
- `QUERY_GC_TIME` - 10 minutes (unused data stays in cache)

### Query Key Factories

Hierarchical query key factories for consistent cache management:

```typescript
import { authKeys, gameKeys, progressKeys, savedSentencesKeys } from '@vela/common';

// Auth keys
authKeys.all; // ['auth']
authKeys.session(); // ['auth', 'session']
authKeys.profile(userId); // ['auth', 'profile', userId]

// Game keys
gameKeys.all; // ['games']
gameKeys.vocabulary(10); // ['games', 'vocabulary', 10]

// Progress keys
progressKeys.all; // ['progress']
progressKeys.analytics(id); // ['progress', 'analytics', id]

// Saved sentences keys
savedSentencesKeys.all; // ['saved-sentences']
savedSentencesKeys.list(); // ['saved-sentences', 'list', undefined]
```

## Usage

### In Web App (`@vela/app`)

```typescript
// apps/vela/src/boot/query.ts
import { createQueryClient } from '@vela/common';

export const queryClient = createQueryClient();
```

```typescript
// apps/vela/src/stores/auth.ts
import { authKeys, QUERY_STALE_TIME } from '@vela/common';
import { queryClient } from '../boot/query';

const loadUserProfile = async (userId: string) => {
  const queryKey = authKeys.profile(userId);
  const isStale = dataAge > QUERY_STALE_TIME;
  // ...
};
```

### In Extension (`@vela/ext`)

```typescript
// apps/vela-ext/entrypoints/popup/main.ts
import { createQueryClient } from '@vela/common';

const queryClient = createQueryClient();
app.use(VueQueryPlugin, { queryClient });
```

## Benefits

✅ **Single Source of Truth**: Cache configuration in one place  
✅ **Consistency**: Both apps use same query keys and timing  
✅ **Type Safety**: Shared TypeScript types  
✅ **Maintainability**: Update cache strategy globally  
✅ **DRY**: No duplicate query key definitions

## Development

```bash
# Build the package
pnpm build

# Watch mode for development
pnpm dev

# Lint
pnpm lint
```

## Dependencies

- `@tanstack/vue-query` ^5.90.5
- `vue` ^3.5.0

## Note

This package contains only configuration and utilities. Query hooks that depend on app-specific services (like `useUserProfileQuery`) remain in each app's codebase to maintain proper separation of concerns.
