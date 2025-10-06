# Repository Guidelines

## Project Structure & Module Organization
This Turborepo workspace hosts both runtime and infrastructure code. The Quasar/Vue app lives in `apps/vela/src`, with static assets in `apps/vela/public` and Playwright specs in `apps/vela/e2e`. Lambda-ready API handlers sit in `apps/vela-api/src` with Vitest suites in `apps/vela-api/test`. CDK stacks are declared in `packages/cdk/lib/vela-stack.ts` and helper scripts in `packages/cdk/scripts`. Create shared utilities as packages under `packages/` for reuse across apps.

## Build, Test, and Development Commands
- `npm install` — install all workspace dependencies at the root.
- `npm run dev` — launch default dev tasks; `npm run --workspace apps/vela dev` targets the app only.
- `npm run build` — compile every workspace before release or packaging.
- `npm run test` — run repo-wide suites; use `npm run --workspace apps/vela test:unit` or `npm run --workspace apps/vela test:e2e` for focused checks.
- `npm run cdk:deploy` — deploy the CDK stack after reviewing `npm run cdk:diff`.
- `npm run lint` / `npm run format` — apply ESLint and Prettier rules.

## Coding Style & Naming Conventions
Prettier enforces two-space indentation, trailing semicolons, and single quotes—run `npm run format` before committing. ESLint (see `eslint.config.js`) allows intentionally unused values only when prefixed with `_`. Name Vue components with `PascalCase`, composables with `useSomething`, and stores or actions in `camelCase`. Prefer typed interfaces over `any` in both app and CDK code, and colocate feature-specific styles or assets with the component they support.

## Testing Guidelines
Vitest powers unit tests placed alongside code as `*.test.ts` (e.g., `authService.test.ts`). Playwright covers end-to-end flows in `apps/vela/e2e/*.spec.ts`; add scenarios per feature to keep suites focused. Run `npm run test` before submitting a PR and regenerate reports with `npm run --workspace apps/vela test:report` when debugging failures. Cover new DynamoDB paths, auth checks, and API integrations with regression tests whenever they change.

## Commit & Pull Request Guidelines
Use Conventional Commits (`feat: allow offline practice mode`) and limit each commit to a single concern. Pull requests need a short summary, linked issue or ticket, and evidence that `npm run lint`, `npm run test`, and `npm run cdk:synth` succeeded. Include UI screenshots when you change visible flows and note deployment risks or required migrations.

## Security & Configuration Tips
Copy `.env.example` to configure local secrets and keep `.env*` files out of version control. Verify AWS credentials before running any `npm run cdk:*` command, and document new environment variables in the relevant README or `.env.example`.
