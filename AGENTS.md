# AGENTS.md - Vela Japanese Learning App

## Build, Lint, and Test Commands

- `pnpm install` - Install all workspace dependencies.
- `pnpm dev` - Start development servers (app, API, extension).
- `pnpm build` - Build all packages for production.
- `pnpm lint` / `pnpm format` - Lint and format code with ESLint/Prettier.
- `pnpm test` - Run all tests; for single test: `pnpm --filter @vela/app run test -- some.spec.ts` (Playwright/Vitest).
- `pnpm --filter @vela/app run test:unit` - Run unit tests only.
- `pnpm --filter @vela-api run test` - Run API tests only.

## Code Style Guidelines

- **Formatting**: Prettier enforces 2-space indentation, trailing semicolons, single quotes. Run `pnpm format` before committing.
- **Imports**: Organize imports: external libraries first, then internal modules; group by type (types, components, services).
- **Types**: Use TypeScript strictly; prefer typed interfaces over `any`; enable Vue SFC type checking.
- **Naming**: Vue components in PascalCase, composables as `useSomething`, stores/actions in camelCase, constants in UPPER_CASE.
- **Error Handling**: Use try-catch for async operations; log errors appropriately; avoid exposing sensitive info in logs.
- **Conventions**: Colocate styles/assets with components; prefix unused vars with `_`; follow security best practices (no secrets in code).

## Agent Rules

- Cursor/Windsurf: See `.windsurf/rules/project.md` for detailed project structure and commands.
- Copilot: See `.github/instructions/project.instructions.md` for architecture and development patterns.
- Always run `pnpm lint` and `pnpm test` before commits; use Conventional Commits (e.g., `feat: add new game`).
