# Quickstart: Aurora DSQL Migration

This quickstart describes how to work with the Aurora DSQL migration feature in a non-production environment.

## Prerequisites

- Node.js and pnpm installed.
- AWS credentials configured for an account where you can deploy CDK stacks.
- Current branch: `001-aurora-dsql-migration`.

## 1. Install dependencies

```bash
pnpm install
```

## 2. Synthesize and review infrastructure changes

From `packages/cdk/`:

```bash
pnpm cdk:synth
pnpm cdk:diff
```

Confirm that the `DatabaseStack` diff shows an Aurora DSQL cluster being created instead of the previous Aurora PostgreSQL cluster, and that no additional relational clusters are introduced.

## 3. Deploy to a non-production environment

From `packages/cdk/`:

```bash
pnpm cdk:deploy DatabaseStack ApiStack
```

After deployment, verify in the AWS console (or via CLI) that:

- An Aurora DSQL cluster exists in the application VPC.
- No legacy Aurora PostgreSQL cluster remains for Vela.

## 4. Run API locally against the deployed infrastructure

From `apps/vela-api/`:

```bash
pnpm install
pnpm dev
```

Ensure that the required Aurora DSQL environment variables (cluster ARN, secret ARN, database name) are set for the dev server, either via `.env` or your shell environment.

## 5. Exercise the DSQL health-check

Once the API is running and wired to the Aurora DSQL cluster:

- Call the internal DSQL health-check endpoint or script (to be implemented as part of this feature) that executes a trivial query (for example, `SELECT 1`).
- Confirm that logs show a successful connection and query result.

## 6. Run tests

From the repository root:

```bash
pnpm test
```

Confirm that:

- Existing DynamoDB-backed tests continue to pass without modification.
- Any new DSQL health-check tests (if added) pass consistently.
