# Feature Specification: Aurora DSQL Migration

**Feature Branch**: `001-aurora-dsql-migration`  
**Created**: 2025-11-26  
**Status**: Draft  
**Input**: User description: "For the aurora RDS database, I want to migrate to Aurora DSQL. Let's analyze the code package and plan what need to be changed"

## User Scenarios & Testing _(mandatory)_

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.

  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - Platform uses Aurora DSQL (Priority: P1)

As an engineer maintaining Vela infrastructure,  
I want the platform's relational database infrastructure to use Aurora DSQL instead of the existing Aurora RDS cluster,  
so that we standardize on Aurora DSQL and remove unused relational resources.

**Why this priority**: This change aligns our relational database choice with future plans while removing an unused Aurora RDS cluster. With no active customers, we can prioritize speed and simplicity while still validating that infrastructure and APIs remain healthy.

**Independent Test**: Deploy the infrastructure into a non-production environment and verify that:

- The only relational database cluster for Vela is an Aurora DSQL cluster.
- The API service can successfully execute a simple test query against the DSQL cluster using the configured access method.

**Acceptance Scenarios**:

1. **Given** a clean AWS account with no existing Vela infrastructure, **When** the database and API stacks are deployed, **Then** an Aurora DSQL cluster exists and no Aurora RDS (Aurora PostgreSQL) cluster exists.
2. **Given** the API service is deployed with the new database configuration, **When** a health-check operation issues a trivial query (for example, `SELECT 1`) against the DSQL cluster, **Then** the query succeeds and the result is logged as a success.

---

### User Story 2 - Low-risk migration for existing workloads (Priority: P2)

As an engineer responsible for reliability,  
I want to migrate from the existing Aurora RDS definition to Aurora DSQL without changing current DynamoDB-backed behavior,  
so that the migration is fast and low-risk.

**Why this priority**: Current workloads rely on DynamoDB only and the Aurora cluster is effectively unused. This allows us to treat the migration as infrastructure-only (no data migration) while ensuring all existing application behavior continues to function.

**Independent Test**:  
Run the existing automated tests and key manual checks for DynamoDB-backed endpoints before and after the migration and confirm the results are identical.

**Acceptance Scenarios**:

1. **Given** the current automated test suite, **When** tests are run against an environment after the migration to Aurora DSQL, **Then** all tests that passed before the migration still pass with no changes to expectations.
2. **Given** the database stack resources in a non-production environment, **When** the infrastructure is destroyed using the existing infrastructure-as-code tooling, **Then** all Aurora DSQL resources are removed cleanly without drift or orphaned security groups.

---

### User Story 3 - Clear configuration and observability (Priority: P3)

As an engineer extending the platform in the future,  
I want Aurora DSQL connectivity and configuration to be explicit and observable,  
so that new relational features can be built safely on top of the new cluster.

**Why this priority**: Clear configuration and basic observability for DSQL ensures that future engineers can quickly understand how to connect to the cluster and diagnose connectivity issues.

**Independent Test**:  
Inspect configuration types and logs to confirm that:

- All required Aurora DSQL environment variables are explicitly modeled.
- Health-check queries produce clear success and failure logs.

**Acceptance Scenarios**:

1. **Given** the API service codebase, **When** I inspect the environment configuration types, **Then** Aurora/DSQL-related configuration (cluster identifier/ARN, secret ARN, database name) is explicitly represented.
2. **Given** an environment with intentionally misconfigured DSQL access (for example, an invalid secret ARN), **When** the health-check query runs, **Then** it fails with a clear, logged error message indicating a DSQL connectivity or configuration problem.

---

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- What happens when Aurora DSQL provisioning fails during infrastructure deployment (for example, invalid engine version, insufficient quota, or missing feature support in the target region)?
- How does the system handle Aurora DSQL connectivity failures at runtime (for example, throttling, temporary outages, or authentication failures)?

## Requirements _(mandatory)_

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: The platform MUST provision a single Aurora DSQL cluster for Vela in the application VPC and MUST NOT provision any Aurora RDS (Aurora PostgreSQL) cluster as part of the Vela infrastructure.
- **FR-002**: The application backend MUST be configured with all information required to connect to the Aurora DSQL cluster (including cluster identifier or ARN, credentials secret, and database name) via environment configuration.
- **FR-003**: The application backend's execution role MUST include only the minimal set of permissions required to execute SQL statements against the Aurora DSQL cluster using the managed access mechanism provided by AWS, and MUST NOT retain obsolete permissions that target the deprecated Aurora RDS cluster.
- **FR-004**: The system MUST provide a simple health-check operation that can execute a trivial query against the DSQL cluster and log whether connectivity is successful or not.
- **FR-005**: The existing infrastructure-as-code workflows MUST continue to support synthesizing, deploying, and destroying all Vela stacks after the migration without requiring manual AWS console changes for database resources.
- **FR-006**: Existing DynamoDB-backed API behaviors (profiles, vocabulary, sentences, game sessions, daily progress, saved sentences, TTS settings) MUST continue to function with unchanged inputs and outputs after the migration.
- **FR-007**: It MUST be safe to delete any legacy Aurora RDS resources (clusters, instances, related secrets, security groups) associated with Vela in non-production environments after the migration without breaking deployed infrastructure.

### Key Entities _(include if feature involves data)_

- **Aurora DSQL Cluster**: The managed relational database cluster used for current and future SQL workloads in Vela, deployed into private subnets of the application VPC and identified by its cluster identifier/ARN and database name.
- **Database Credentials Secret**: The managed secret that stores credentials or authentication material used by the application backend to connect to the Aurora DSQL cluster.
- **Application Backend (API Service)**: The compute layer that establishes connectivity to Aurora DSQL using configuration and executes health-check queries (and future workload queries).

### Assumptions

- Current production workloads store their data in DynamoDB tables; the existing Aurora RDS cluster does not hold user data that must be preserved.
- There are no active end users at the time of migration, so short maintenance windows in non-production environments are acceptable while updating infrastructure.
- The chosen AWS region supports Aurora DSQL and the required features for this migration.

## Success Criteria _(mandatory)_

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: In a fresh non-production environment, the Vela infrastructure can be fully provisioned and torn down using the existing automation, with Aurora DSQL as the only relational database cluster and no deployment errors related to database resources.
- **SC-002**: A basic health-check query against the Aurora DSQL cluster succeeds in at least 99% of test invocations over a representative sample (for example, 100 consecutive calls) in non-production.
- **SC-003**: All existing automated tests for DynamoDB-backed API features that passed prior to the migration continue to pass after the migration without modification to their expectations.
- **SC-004**: A code review confirms there are no remaining references in the infrastructure codebase or configuration to the deprecated Aurora RDS cluster (including engine type, identifiers, or secrets), and this review is documented for the feature.
