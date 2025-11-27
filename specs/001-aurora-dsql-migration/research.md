# Research: Aurora DSQL Migration

## Decisions

1. **Adopt Aurora DSQL as the only relational database for Vela**
   - Replace the existing Aurora PostgreSQL (Aurora RDS) cluster definition in `packages/cdk/lib/database-stack.ts` with an Aurora DSQL cluster defined via the `AWS::DSQL::Cluster` CloudFormation resource using CDK L1 constructs.
   - Keep the existing VPC, subnet, and security group model.

2. **Treat the migration as infra-only for now**
   - No current workloads persist business data to Aurora; all production data is in DynamoDB tables.
   - This feature will not introduce new relational workloads or migrate DynamoDB-backed behaviors.

3. **Expose Aurora DSQL to the API via existing Lambda + VPC pattern**
   - Continue to run the API as a Lambda in the application VPC.
   - Pass Aurora DSQL identifiers and secret ARNs to the Lambda via environment variables.

4. **Use the AWS-recommended access mechanism for Aurora DSQL from Lambda**
   - Use the Aurora DSQL Connector for node-postgres together with `@aws-sdk/dsql-signer` to establish IAM-authenticated, TLS-encrypted PostgreSQL connections from the API Lambda to the Aurora DSQL cluster.
   - The API will encapsulate this access in a small helper module (planned as `apps/vela-api/src/dsql.ts`).

5. **Add a simple DSQL connectivity health-check**
   - Implement a function that performs a trivial query (for example, `SELECT 1`) and logs success/failure.
   - Optionally expose this via an internal-only endpoint for observability.

6. **Avoid manual console changes**
   - All infrastructure creation and teardown for Aurora DSQL must be driven through CDK commands.

## Rationale

- **Unused Aurora RDS cluster**: Since the existing Aurora cluster is not used by the application, we can safely replace it rather than running a dual-cluster or data-migration strategy.
- **Simplicity and speed**: With no active customers, the cost of a short infra-only deployment window is low, and the simplest approach is preferred.
- **Future-proofing**: Having Aurora DSQL provisioned and reachable from the API prepares the platform for future relational workloads without impacting current DynamoDB functionality.
- **Operational clarity**: A dedicated health-check establishes a clear way to verify that DSQL connectivity and configuration are working as expected.

## Alternatives Considered

1. **Keep Aurora PostgreSQL (Aurora RDS) and add Aurora DSQL alongside it**
   - _Rejected because_: It adds complexity (two clusters) without any current need. There is no data or workload that depends on the existing Aurora RDS cluster.

2. **Remove relational database entirely for now**
   - _Rejected because_: The long-term direction is to have relational capabilities for Vela. Removing the cluster would defer necessary work and remove the opportunity to validate DSQL in lower environments.

3. **Introduce new services or separate repository for relational workloads**
   - _Rejected because_: The current scale does not justify additional services. Reusing the existing API Lambda and CDK stacks keeps the design simple and maintainable.

## Open Questions (to be resolved during implementation)

- None currently. Engine family (Aurora DSQL via `AWS::DSQL::Cluster`) and Lambda access pattern (Aurora DSQL Connector for node-postgres + `@aws-sdk/dsql-signer`) have been selected. Any additional questions that arise during implementation (for example, tuning options or advanced multi-Region settings) should be recorded here.
