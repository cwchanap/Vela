# Implementation Plan: Aurora DSQL Migration

**Branch**: `001-aurora-dsql-migration` | **Date**: 2025-11-26 | **Spec**: `specs/001-aurora-dsql-migration/spec.md`  
**Input**: Feature specification from `specs/001-aurora-dsql-migration/spec.md`

**Note**: This plan is filled in by the `/speckit.plan` workflow for the Aurora DSQL migration feature.

## Summary

Migrate the Vela platform's relational database infrastructure from an unused Aurora PostgreSQL (Aurora RDS) cluster to Aurora DSQL, while leaving all existing DynamoDB-backed application behavior unchanged. The migration is infrastructure-focused: update the CDK `DatabaseStack` to provision Aurora DSQL instead of the current Aurora cluster, keep the existing VPC and security group model, and ensure the API Lambda is configured with the correct DSQL cluster and secret ARNs.

Because there are currently no active customers and the existing Aurora cluster holds no production data, we treat this as a fast, low-risk change. We will add a simple DSQL connectivity health-check in the API service for observability, but we will not move any existing DynamoDB workloads to DSQL as part of this feature.

## Technical Context

**Language/Version**: TypeScript (Node.js 20 for Lambda, CDK v2 TypeScript for infrastructure)  
**Primary Dependencies**: AWS CDK v2 (`aws-cdk-lib`, `constructs`), AWS SDK v3 (DynamoDB), Hono (API framework), AWS RDS Data API client for executing SQL against Aurora / DSQL  
**Storage**: DynamoDB tables for application data; Aurora DSQL cluster as the single relational database for current and future SQL workloads; S3 for TTS audio and static assets  
**Testing**: Vitest for API tests (`apps/vela-api`), Playwright and Vitest for frontend (`apps/vela`), CDK synthesis/diff/deploy workflows (`pnpm cdk:*`) for infrastructure validation  
**Target Platform**: AWS (Lambda + API Gateway) running in a VPC with private subnets, DynamoDB, Aurora DSQL, S3, Cognito  
**Project Type**: Monorepo with web app, API backend, browser extension, and shared infrastructure code (Turborepo + pnpm workspaces)  
**Performance Goals**: Maintain existing API performance characteristics; DSQL health-check must complete well within current API timeouts and must not materially impact Lambda cold start or steady-state latency  
**Constraints**: Aurora DSQL must be supported in the target AWS region; migrations should be performed via CDK with no manual AWS console steps; zero user impact is required for current DynamoDB-backed behavior  
**Scale/Scope**: Single application (Vela) with development/early-stage usage; this feature touches `packages/cdk` and `apps/vela-api` only, with no new services or projects introduced

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- The current constitution file is a template with no concrete principles or gates defined yet, so there are no formal blocking rules for this feature.
- We will still align with implicit principles of **Simplicity** (infra-only change, no new services) and **Observability** (add DSQL connectivity health-check).
- No additional repositories, services, or technology stacks are introduced; the plan reuses existing CDK and API projects.

## Project Structure

### Documentation (this feature)

```text
specs/001-aurora-dsql-migration/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
packages/
└── cdk/
    └── lib/
        ├── database-stack.ts   # Defines DynamoDB tables, VPC, Aurora cluster (to be DSQL)
        └── api-stack.ts        # Wires API Lambda to VPC, Aurora cluster, and env vars

apps/
└── vela-api/
    ├── src/
    │   ├── index.ts            # API entrypoint and environment wiring
    │   ├── types.ts            # Env config interface (to be extended for DSQL)
    │   ├── dynamodb.ts         # Existing DynamoDB data access layer
    │   └── dsql.ts             # NEW: Aurora DSQL connectivity + health-check helper
    └── test/
        └── dsql-health.test.ts # NEW: Optional tests for DSQL health-check (future)
```

**Structure Decision**: Reuse the existing monorepo structure with no new packages or services. All infrastructure changes are localized to `packages/cdk`, and all runtime behavior changes are localized to `apps/vela-api`. Frontend (`apps/vela`) and browser extension (`apps/vela-ext`) are unaffected by this feature.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation                  | Why Needed         | Simpler Alternative Rejected Because |
| -------------------------- | ------------------ | ------------------------------------ |
| [e.g., 4th project]        | [current need]     | [why 3 projects insufficient]        |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient]  |
