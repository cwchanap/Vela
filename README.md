# Vela Monorepo

A monorepo containing the Vela Japanese Learning App and its AWS CDK infrastructure.

## Structure

- `apps/vela` - The main Vela application (Quasar/Vue.js)
- `packages/cdk` - AWS CDK infrastructure code

## Getting Started

### Prerequisites

- Node.js (18+ recommended)
- npm 6.13.4+

### Installation

```bash
npm install
```

### Development

To start the Vela app in development mode:

```bash
npm run dev
```

This will run the development server for the Vela app.

### Building

To build all packages:

```bash
npm run build
```

### Infrastructure

#### CDK Commands

```bash
# Synthesize CloudFormation template
npm run cdk:synth

# Deploy infrastructure
npm run cdk:deploy

# Check differences
npm run cdk:diff

# Destroy infrastructure
npm run cdk:destroy
```

### Code Quality

```bash
# Lint all packages
npm run lint

# Format all packages
npm run format
```

## Packages

### @vela/app

The main Vela application built with Quasar Framework (Vue 3 + TypeScript). Features include:

- Japanese vocabulary learning games
- Sentence anagram games
- User progress tracking with Supabase
- Authentication with Supabase Auth

### @vela/cdk

AWS CDK infrastructure for deploying the Vela application and its backend services.

## Development Workflow

This monorepo uses Turborepo for task orchestration and caching. Tasks are defined in `turbo.json` and can be run across all packages or for specific packages.

## License

Private
