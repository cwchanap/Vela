<!--
Sync Impact Report:
Version Change: 0.0.0 → 1.0.0
Modified Principles: N/A (Initial ratification)
Added Sections:
  - All core principles (I-VII)
  - Technology Stack & Architecture
  - Development Workflow & Quality Gates
  - Security & Compliance
Removed Sections: N/A
Templates Requiring Updates:
  ✅ plan-template.md - Constitution Check section aligns with principles
  ✅ spec-template.md - Requirements align with testing and user story principles
  ✅ tasks-template.md - Task organization reflects test-first and independent delivery
Follow-up TODOs: None
-->

# Vela Constitution

## Core Principles

### I. TypeScript-First Development

All application code MUST be written in TypeScript with strict type checking enabled. The use of `any` type is prohibited except in rare cases where external library interop requires it, which MUST be documented and justified. Vue Single File Components (SFCs) MUST have type checking enabled via `vite-plugin-checker`.

**Rationale**: Type safety prevents entire classes of runtime errors, improves IDE support, enables confident refactoring, and serves as inline documentation. For a learning application handling user data and progress, type safety is critical to data integrity.

### II. Monorepo Architecture

The project MUST maintain a monorepo structure using pnpm workspaces and Turborepo for task orchestration. Code MUST be organized into distinct workspaces:

- `apps/*` for deployable applications (app, API, extension)
- `packages/*` for shared libraries (CDK infrastructure, common utilities)

Each workspace MUST have clear boundaries, explicit dependencies, and independent versioning. Shared code MUST be extracted to `packages/common` rather than duplicated.

**Rationale**: Monorepo enables atomic commits across related changes, shared tooling configuration, and efficient CI/CD caching while maintaining clear separation of concerns.

### III. Test-First Development (NON-NEGOTIABLE)

Tests MUST be written BEFORE implementation. The development cycle is:

1. Write test that captures expected behavior
2. Verify test fails (red)
3. Implement minimum code to pass test (green)
4. Refactor while keeping tests green

End-to-end tests use Playwright, unit tests use Vitest. Each user story MUST have acceptance scenarios defined in Given-When-Then format before implementation begins.

**Rationale**: Test-first development ensures requirements are clear, prevents over-engineering, provides living documentation, and enables confident refactoring. For a learning app, this ensures game mechanics, progress tracking, and user flows work reliably.

### IV. Component-Driven UI Development

User interfaces MUST be built using Vue 3 Composition API with Quasar Framework components. UI logic MUST be organized as:

- **Components**: Reusable, tested, self-contained UI elements in `src/components/`
- **Pages**: Route-level components in `src/pages/`
- **Layouts**: Structural templates in `src/layouts/`
- **Composables**: Shared reactive logic prefixed with `use*` in `src/composables/`

Components MUST be colocated with their styles and assets. Complex components MUST have corresponding unit tests.

**Rationale**: Component-driven development promotes reusability, testability, and maintainability. Quasar provides production-ready, accessible components that accelerate development while maintaining quality.

### V. API-First Backend Design

Backend services MUST expose RESTful APIs with clear contracts. All endpoints MUST:

- Accept and return JSON
- Use proper HTTP status codes
- Validate input using Zod schemas
- Handle errors consistently via middleware
- Document expected requests/responses

API contracts MUST be defined before implementation. Database access MUST go through service layers, never directly from routes.

**Rationale**: API-first design enables parallel frontend/backend development, facilitates testing via contract tests, and supports future mobile app or third-party integrations.

### VI. Security & Authentication

User authentication MUST use AWS Cognito with email/password credentials. Security requirements:

- NO secrets, API keys, or credentials in source code
- Environment variables for all configuration via `VITE_*` prefix
- Input validation on all user-provided data
- DynamoDB row-level security via authenticated user ID
- Error messages MUST NOT expose sensitive information
- Dependencies MUST be regularly audited for vulnerabilities

**Rationale**: As a learning application storing user progress and personal data, security is non-negotiable. AWS Cognito provides enterprise-grade authentication, and following security best practices protects user privacy.

### VII. Code Quality & Consistency

Code quality MUST be enforced through automated tooling:

- **ESLint**: Lint all TypeScript/Vue files before commit
- **Prettier**: Format with 2-space indentation, single quotes, trailing semicolons
- **Husky + lint-staged**: Pre-commit hooks run linting and formatting
- **Conventional Commits**: Use semantic commit messages (feat, fix, docs, etc.)

Code reviews MUST verify adherence to these standards. Complexity MUST be justified with comments explaining "why" not "what".

**Rationale**: Consistent formatting eliminates bikeshedding, automated linting catches common errors, and conventional commits enable automated changelogs and semantic versioning.

## Technology Stack & Architecture

### Required Stack

- **Frontend**: Vue 3 (Composition API) + Quasar Framework + TypeScript
- **State Management**: Pinia stores for reactive application state
- **Backend API**: Node.js + Express (via vela-api workspace)
- **Database**: AWS DynamoDB with single-table design
- **Authentication**: AWS Cognito
- **Build Tool**: Vite with manual chunk splitting
- **Monorepo**: pnpm workspaces + Turborepo
- **Deployment**: AWS CDK for infrastructure as code

### Architecture Patterns

- **Store Organization**: Separate Pinia stores for auth, games, chat, progress
- **Service Layer**: Business logic in `src/services/` separate from components
- **Routing**: Vue Router with meta-based guards (`requiresAuth`, `requiresGuest`)
- **Environment Config**: Centralized in `src/config/` with validation
- **Database Schema**: Entities include profiles, vocabulary, sentences, user_progress, game_sessions, chat_history

## Development Workflow & Quality Gates

### Development Commands

- `pnpm install` - Install dependencies (run after cloning or pulling new deps)
- `pnpm dev` - Start all development servers in parallel
- `pnpm build` - Build all packages for production
- `pnpm lint` / `pnpm format` - Check and fix code quality
- `pnpm test` - Run all tests (Playwright E2E + Vitest unit)

### Pre-Commit Requirements

Before every commit, developers MUST:

1. Run `pnpm lint` and fix all errors
2. Run `pnpm format` to ensure consistent formatting
3. Run relevant tests (`pnpm test` or scoped to affected workspace)
4. Write commit message using Conventional Commits format

Husky pre-commit hooks automate steps 1-2 via lint-staged.

### Pull Request Quality Gates

Every PR MUST:

- Pass all CI checks (lint, format, tests)
- Have tests for new functionality
- Update relevant documentation (README, JSDoc, comments)
- Be reviewed by at least one other developer
- Have a descriptive title following Conventional Commits
- Reference related issues or specs (e.g., "Implements #123" or "Closes spec-456")

## Security & Compliance

### Data Protection

- User data MUST be scoped by authenticated user ID in DynamoDB
- Sensitive operations (profile updates, progress writes) MUST verify user ownership
- API endpoints MUST use authentication middleware
- Client-side storage MUST NOT contain sensitive tokens (rely on Cognito session management)

### Environment Configuration

- Development: Local API, optional local DynamoDB
- Production: Environment variables for Cognito pool IDs, API URLs, DynamoDB table names
- Config validation MUST run at application startup and fail fast on missing required vars

### Testing Account

For development and testing purposes only:

- Email: testuser.vela@gmail.com
- Password: TestPass123!
- MUST NOT be used in production

## Governance

### Amendment Process

1. Proposed changes MUST be documented with rationale
2. Changes MUST be reviewed by project maintainers
3. Breaking changes require MAJOR version bump
4. New principles or sections require MINOR version bump
5. Clarifications or fixes require PATCH version bump

### Version Semantics

- **MAJOR (X.0.0)**: Backward-incompatible governance changes, principle removals
- **MINOR (X.Y.0)**: New principles, expanded guidance, new sections
- **PATCH (X.Y.Z)**: Clarifications, typo fixes, formatting improvements

### Compliance

All development work MUST comply with this constitution. Violations MUST be justified in implementation plans under "Complexity Tracking" section. Reviews MUST verify constitution compliance before approval.

For detailed development guidance, refer to:

- `.github/instructions/project.instructions.md` - Architecture and patterns
- `AGENTS.md` - Commands and style guidelines
- `.specify/templates/` - Spec, plan, and task templates

**Version**: 1.0.0 | **Ratified**: 2025-10-27 | **Last Amended**: 2025-10-27
