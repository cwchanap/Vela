# Data Model: Aurora DSQL Migration

## Overview

This feature is infrastructure-focused and does **not** introduce new business-domain entities. Instead, it refines the platform-level entities that describe how the application connects to a relational database.

## Entities

### Aurora DSQL Cluster

- **Description**: Managed relational database cluster for current and future SQL workloads in Vela.
- **Attributes (conceptual)**:
  - Cluster identifier/ARN
  - Engine type / version (Aurora DSQL)
  - Default database name (e.g., `vela`)
  - VPC and subnet associations (private subnets only)
  - Security groups (allowing traffic from the application VPC only)
- **Relationships**:
  - Uses credentials stored in the Database Credentials Secret.
  - Is accessed by the Application Backend (API Service).

### Database Credentials Secret

- **Description**: Managed secret storing the authentication material required for the API to connect to the Aurora DSQL cluster.
- **Attributes (conceptual)**:
  - Secret ARN
  - Username
  - Password or authentication material
- **Relationships**:
  - Referenced by the Aurora DSQL Cluster for its credentials.
  - Referenced by the Application Backend (API Service) for runtime connectivity.

### Application Backend (API Service)

- **Description**: Lambda-based API that may execute SQL statements against Aurora DSQL in the future and performs a simple health-check for this feature.
- **Attributes (conceptual)**:
  - Environment configuration values:
    - Aurora cluster identifier/ARN
    - Aurora database name
    - Secret ARN for credentials
  - IAM role with minimal permissions to execute SQL statements via the AWS-recommended access mechanism.
- **Relationships**:
  - Connects to the Aurora DSQL Cluster using the Database Credentials Secret.
  - Continues to use DynamoDB tables as the primary data store for current features.

## Non-goals

- No new relational tables or schemas are defined as part of this feature.
- No migration of DynamoDB data into Aurora DSQL is performed.
