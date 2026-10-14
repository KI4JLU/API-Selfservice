# Changelog

All notable changes to this project will be documented in this file.

## [0.9.0] - 2026-10-14

### Added

- Cost center detail page with key figures, members, budget usage (by user, key or model) and an event log for cost center admins (#13)
- Budgets per member of a cost center: default budget per user and individual budgets, enforced by LiteLLM (#15)
- SAP export of the API costs as CSV for the LSMW import, with preview and history; SAP recipient is required for cost centers (#14)
- Choose the key expiry when creating a key and change it later (at most 6 months after creation) (#11)
- "Erneuern" creates a new key with the same settings instead of extending the old one; reminders 7 days and 1 day ahead link to it (#11)
- Collapsible provider groups with filter in the key dialog (#9) and a grouped popover for long model lists in the keys table (#10)
- Resync all cost centers to LiteLLM from the admin cost center page
- Live e2e suite against a real LiteLLM proxy; `pnpm test:e2e:local` runs it against the local Docker stack with `.env.test`

### Changed

- Expired keys are no longer blocked in LiteLLM; LiteLLM enforces the expiry itself (#11)
- The mock e2e suite always runs with the LiteLLM mock in its own schema
- The live suite refuses a LiteLLM that is not on this machine unless `E2E_ALLOW_REMOTE=1` (`pnpm test:e2e:live`)
- Deactivating a user blocks their keys only; LiteLLM has no user block

### Fixed

- Key test reports provider errors instead of claiming the key was rejected (#8)
- Max-Budget and Zeitraum fields aligned in the cost center dialog (#12)
- Model list no longer covers the save button in the cost center dialog
- Cost center budgets above 0 and below 0,01 EUR are accepted
- Renewal never creates a key without models; expiry changes respect exhausted budgets and admin blocks

### Security

- CSV exports neutralise values that spreadsheets would run as formulas; SAP posting texts must not start with = + - @

## [0.8.1] - 2026-10-05

### Added

- Show app version in the sidebar footer and on the login page

### Changed

- Copy JLU Design System tokens into the web app instead of installing the package

### Fixed

- Coolify Docker build failing on the git-based design system dependency

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
