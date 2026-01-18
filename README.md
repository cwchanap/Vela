# Vela Monorepo

A monorepo containing the Vela Japanese Learning App and its AWS CDK infrastructure.

## Structure

- `apps/vela` - The main Vela application (Quasar/Vue.js)
- `packages/cdk` - AWS CDK infrastructure code

## Getting Started

### Prerequisites

- Bun 1.1+

### Installation

```bash
bun install
```

### Development

To start the Vela app in development mode:

```bash
bun dev
```

This will run the development server for the Vela app.

### Building

To build all packages:

```bash
bun build
```

### Infrastructure

#### CDK Commands

```bash
# Synthesize CloudFormation template
bun cdk:synth

# Deploy infrastructure
bun cdk:deploy

# Check differences
bun cdk:diff

# Destroy infrastructure
bun cdk:destroy
```

### Code Quality

```bash
# Lint all packages
bun lint

# Format all packages
bun format
```

## Packages

### @vela/app

The main Vela application built with Quasar Framework (Vue 3 + TypeScript). Features include:

- Japanese vocabulary learning games
- Sentence anagram games
- User progress tracking with DynamoDB
- Authentication with AWS Cognito

### @vela/cdk

AWS CDK infrastructure for deploying the Vela application and its backend services.

## Development Workflow

This monorepo uses Turborepo for task orchestration and caching. Tasks are defined in `turbo.json` and can be run across all packages or for specific packages.

## License

Private
