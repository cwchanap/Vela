# Repository Guidelines

## Project Structure & Module Organization

This Turborepo workspace hosts both runtime and infrastructure code. The Quasar/Vue app lives in `apps/vela/src`, with static assets in `apps/vela/public` and Playwright specs in `apps/vela/e2e`. Lambda-ready API handlers sit in `apps/vela-api/src` with Vitest suites in `apps/vela-api/test`. CDK stacks are declared in `packages/cdk/lib/vela-stack.ts` and helper scripts in `packages/cdk/scripts`. Create shared utilities as packages under `packages/` for reuse across apps.

## Build, Test, and Development Commands

- `pnpm install` — install all workspace dependencies at the root.
- `pnpm dev` — launch default dev tasks; `pnpm --filter @vela/app run dev` targets the app only.
- `pnpm build` — compile every workspace before release or packaging.
- `pnpm test` — run repo-wide suites; use `pnpm --filter @vela/app run test:unit` or `pnpm --filter @vela/app run test:e2e` for focused checks.
- `pnpm cdk:deploy` — deploy the CDK stack after reviewing `pnpm cdk:diff`.
- `pnpm lint` / `pnpm format` — apply ESLint and Prettier rules.

## Coding Style & Naming Conventions

Prettier enforces two-space indentation, trailing semicolons, and single quotes—run `pnpm format` before committing. ESLint (see `eslint.config.js`) allows intentionally unused values only when prefixed with `_`. Name Vue components with `PascalCase`, composables with `useSomething`, and stores or actions in `camelCase`. Prefer typed interfaces over `any` in both app and CDK code, and colocate feature-specific styles or assets with the component they support.

## Testing Guidelines

Vitest powers unit tests placed alongside code as `*.test.ts` (e.g., `authService.test.ts`). Playwright covers end-to-end flows in `apps/vela/e2e/*.spec.ts`; add scenarios per feature to keep suites focused. Run `pnpm test` before submitting a PR and regenerate reports with `pnpm --filter @vela/app run test:report` when debugging failures. Cover new DynamoDB paths, auth checks, and API integrations with regression tests whenever they change.

## Commit & Pull Request Guidelines

Use Conventional Commits (`feat: allow offline practice mode`) and limit each commit to a single concern. Pull requests need a short summary, linked issue or ticket, and evidence that `pnpm lint`, `pnpm test`, and `pnpm cdk:synth` succeeded. Include UI screenshots when you change visible flows and note deployment risks or required migrations.

## Security & Configuration Tips

Copy `.env.example` to configure local secrets and keep `.env*` files out of version control. Verify AWS credentials before running any `pnpm cdk:*` command, and document new environment variables in the relevant README or `.env.example`.
