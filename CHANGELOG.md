# Changelog

All notable changes to this project will be documented in this file.

## [0.8.0] - 2026-10-05

### Added

- Add pnpm workspace configuration and setup scripts
- Add key testing page and API endpoint
- Add cost center members with owner role, replacing cost center admins
- Add cost center directory and join requests
- Extend dashboard on the start page

### Changed

- Rename schema and package references from `litelite` to `api_selfservice`
- Limit pnpm built dependencies to the design system
- Run API Docker image from TypeScript sources
- Rework LiteLLM HTTP client, key, spend and report services
- Remove redundant deactivated-user checks from admin walkthrough e2e tests

### Fixed

- Show authentication errors on the login page
- Correct health check timeout and database service name in Docker Compose

### Infrastructure

- Add Docker Compose configuration for Coolify deployment

### Docs

- Add in-app help pages for admin features and user management
