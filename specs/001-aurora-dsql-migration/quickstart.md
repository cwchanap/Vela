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

Ensure that the required Aurora DSQL environment variables are set for the dev server, either via `.env` or your shell environment. At minimum:

- `AURORA_DB_CLUSTER_ARN` – Aurora DSQL cluster ARN (from `DatabaseStack`/`VelaStack` outputs)
- `AURORA_DB_SECRET_ARN` – Secrets Manager ARN for the Aurora credentials
- `AURORA_DB_ENDPOINT` – Aurora DSQL cluster endpoint hostname
- `AURORA_DB_NAME` – Logical database name (for example, `vela`)
- `AURORA_DB_USER` – Database user for the health-check (defaults to `admin` if not set)

## 5. Exercise the DSQL health-check

Once the API is running and wired to the Aurora DSQL cluster:

- Call the internal DSQL health-check endpoint, which executes a trivial query (`SELECT 1`) against Aurora DSQL:
  - Locally (dev server): `GET http://localhost:9005/api/internal/dsql-health`
  - Deployed via API Gateway/CloudFront: `GET https://<your-domain>/api/internal/dsql-health`

- Confirm that the endpoint returns `{"status":"ok", ...}` and that logs show a successful connection and query result. If configuration is invalid (for example, missing `AURORA_DB_ENDPOINT`), the logs will include a structured `"[DSQL] Health-check configuration error"` entry describing which variables are missing.

## 6. Run tests

From the repository root:

```bash
pnpm test
```

Confirm that:

- Existing DynamoDB-backed tests continue to pass without modification.
- Any new DSQL health-check tests (if added) pass consistently.
