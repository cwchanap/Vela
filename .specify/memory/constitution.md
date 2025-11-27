<!--
  Sync Impact Report
  ===================
  Version change: N/A → 1.0.0 (initial ratification)

  Modified principles: N/A (new document)

  Added sections:
  - Core Principles (5 principles)
  - Technology Stack Requirements
  - Development Workflow
  - Governance

  Removed sections: N/A

  Templates requiring updates:
  - .specify/templates/plan-template.md ✅ (Constitution Check section compatible)
  - .specify/templates/spec-template.md ✅ (no constitution references needed)
  - .specify/templates/tasks-template.md ✅ (test discipline aligned)

  Follow-up TODOs: None
-->

# Vela Constitution

## Core Principles

### I. TypeScript Strictness

All packages in the monorepo MUST use strict TypeScript configuration. This includes:

- `strict: true` enabled in all `tsconfig.json` files
- Vue SFC type checking enabled via `vite-plugin-checker` in frontend packages
- No `any` types without explicit justification in code comments
- Comprehensive database types for DynamoDB schema and API contracts

**Rationale**: Strict typing catches errors at compile time, improves refactoring
confidence, and serves as executable documentation for the codebase.

### II. Test Discipline

Testing MUST follow a layered strategy appropriate to each package:

- **E2E Tests (Playwright)**: Required for user-facing flows in `apps/vela`
- **Unit Tests (Vitest)**: Required for business logic, services, and utilities
- **API Tests (Vitest)**: Required for route handlers in `apps/vela-api`
- Tests MUST be written before or alongside implementation (not deferred)
- Test files MUST be co-located or in dedicated `test/` directories

**Rationale**: Layered testing provides confidence at different abstraction levels
while maintaining fast feedback loops for developers.

### III. Monorepo Architecture

The project MUST maintain clean package separation via Turborepo:

- `apps/*` contains deployable applications (vela, vela-api, vela-ext)
- `packages/*` contains shared libraries (cdk, common)
- Cross-package dependencies MUST use workspace protocol (`workspace:*`)
- Shared configuration (TanStack Query, query keys) MUST reside in `@vela/common`
- Build tasks MUST respect dependency graph (`^build` notation in turbo.json)

**Rationale**: Clean separation enables independent deployment, build caching, and
clear ownership boundaries between packages.

### IV. Infrastructure as Code

All AWS infrastructure MUST be defined in AWS CDK (TypeScript):

- No manual console changes to production resources
- CDK stacks MUST be modular with explicit dependencies
- Resource naming MUST use consistent prefixes (`vela-*`)
- Environment-specific configuration MUST use CDK context or environment variables
- Infrastructure changes require `cdk diff` review before deployment

**Rationale**: IaC ensures reproducibility, auditability, and disaster recovery
capabilities for all cloud resources.

### V. Code Quality Gates

Pre-commit quality gates are NON-NEGOTIABLE:

- ESLint MUST pass with flat config (v9+ style) before commit
- Prettier formatting MUST be applied via Husky pre-commit hooks
- TypeScript compilation MUST succeed (no type errors)
- Lint-staged MUST run on staged files only for performance

**Rationale**: Automated quality gates prevent technical debt accumulation and
ensure consistent code style across all contributors.

## Technology Stack Requirements

The following technology choices are canonical for Vela:

| Layer           | Technology                                      | Constraints                         |
| --------------- | ----------------------------------------------- | ----------------------------------- |
| Frontend        | Quasar/Vue 3, TypeScript, Pinia, TanStack Query | Vue 3 Composition API preferred     |
| API             | Hono, TypeScript, Zod                           | Serverless-compatible, <60s timeout |
| Database        | DynamoDB (primary), Aurora Serverless (future)  | Pay-per-request billing mode        |
| Auth            | AWS Cognito                                     | Email/password, JWT validation      |
| CDN             | CloudFront                                      | Custom domain: vela.cwchanap.dev    |
| Extension       | WXT, Vue 3                                      | Chrome/Firefox support              |
| Package Manager | pnpm 9+                                         | Workspaces enabled                  |
| Node.js         | v20 LTS                                         | Lambda runtime constraint           |

Technology changes outside this table require Constitution amendment.

## Development Workflow

### Branch Strategy

- Feature branches: `###-feature-name` (e.g., `001-aurora-dsql-migration`)
- Feature specs: `/specs/###-feature-name/` directory
- Main branch protected; requires passing CI checks

### Development Server Ports

| Application | Port | Purpose                 |
| ----------- | ---- | ----------------------- |
| vela        | 9000 | Quasar dev server       |
| vela-api    | 9005 | Hono dev server         |
| vela-ext    | N/A  | Runs in browser context |

### CI/CD Requirements

- Build and lint MUST pass on all PRs
- E2E tests run on merge to main
- Deployment via CDK after successful CI

## Governance

This Constitution supersedes all informal practices and ad-hoc decisions.

### Amendment Procedure

1. Propose changes via PR modifying this file
2. Document rationale in PR description
3. Update dependent templates if principle changes affect them
4. Increment version according to semantic versioning:
   - **MAJOR**: Principle removal or incompatible redefinition
   - **MINOR**: New principle or material expansion
   - **PATCH**: Clarifications, wording, typo fixes

### Compliance Review

- All PRs SHOULD reference applicable principles when relevant
- Reviewers SHOULD verify Constitution compliance
- Violations require explicit justification in Complexity Tracking section of plans

### Runtime Guidance

Use `AGENTS.md` for detailed development commands and project structure reference.
Constitution defines principles; AGENTS.md provides operational details.

**Version**: 1.0.0 | **Ratified**: 2025-11-27 | **Last Amended**: 2025-11-27
