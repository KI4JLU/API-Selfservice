# API-Selfservice

Self-service portal for an existing LiteLLM proxy: Keycloak SSO, roles (user, cost center admin, admin), cost centers as LiteLLM teams with members, an owner and released models, budgets, API key self-service (single models or whole providers, monthly or one-off key budgets, key test), request logger, reports, email notifications, event log. Requirements: [docs/PRD.md](docs/PRD.md).

Cost centers in short: an admin creates a cost center and picks its owner (a LiteLLM user), who becomes its first cost center admin. Only the owner appoints or removes further cost center admins; all cost center admins add and remove members. Members create keys on the cost center; plain members see its name only, never its budget, spend or owner.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TanStack Router/Query/Table, shadcn/ui components styled with the [JLU Design System](https://github.com/KI4JLU/JLU-Design-System), Tailwind 4, i18next (de/en) |
| Backend | Hono + `@hono/zod-openapi`, Better Auth (Keycloak via generic-oauth), Drizzle ORM, Nodemailer, croner |
| Database | PostgreSQL, dedicated schema (`DB_SCHEMA`, default `api_selfservice`) on the LiteLLM DB host |
| Tests | Vitest (unit/integration), Playwright (API + UI) |

Structure: `apps/api`, `apps/web`, `packages/shared` (Zod schemas, i18n), `packages/db` (Drizzle schema, migrations), `e2e`.

## Running locally

```bash
pnpm setup:dev                  # .env, pnpm install, Postgres + Mailpit (Docker), migrations, seed
pnpm dev                        # API :3030, Web :5173
```

For local development set `LITELLM_MODE=mock` and `DEV_LOGIN_ENABLED=true` in `.env` (`.env.example` ships `http` and `false`). Details, manual steps, Keycloak and real-proxy setup: [docs/SETUP.md](docs/SETUP.md).

- API docs: http://localhost:3030/api/docs (in production only for signed-in admins)
- Mailpit (all mails): http://localhost:8025
- Login without Keycloak: dev login form on the login page (only when `DEV_LOGIN_ENABLED=true`, refused in production).
- Debugging as another user: with `IMPERSONATION_ENABLED=true`, admins can pick "Impersonate" in Users / roles and act as that user in their own session until they click Stop in the banner. Start, end and every action in between are audited (the admin as `impersonatedBy`).
- Login with Keycloak (realm `api-selfservice-dev`, created by `pnpm keycloak:setup`): test users, password = `KC_TEST_USER_PASS` in `.env`.

  | User | Group | eduPersonAffiliation | Result |
  |---|---|---|---|
  | `admin-test` | LiteLLMAdmin | staff | Admin |
  | `user-test` | – | member | User |
  | `ext-test` | – | affiliate | Login rejected |

On startup the API creates the schema, runs migrations, seeds the default cost center `1111 1111`, syncs the models from LiteLLM and mirrors cost center memberships written by migrations to the LiteLLM teams once.

## Configuration

All settings are environment variables, see [.env.example](.env.example). Important ones:

| Variable | Meaning |
|---|---|
| `DATABASE_URL`, `DB_SCHEMA` | Postgres of the LiteLLM host, dedicated schema |
| `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` | OIDC client (see [docs/keycloak.md](docs/keycloak.md), automated via `scripts/keycloak-setup.mts`, see [docs/SETUP.md](docs/SETUP.md)) |
| `KEYCLOAK_ADMIN_GROUP` | Group whose members are automatically admin (`LiteLLMAdmin`) |
| `KEYCLOAK_AFFILIATION_CLAIM`, `KEYCLOAK_AFFILIATION_VALID` | Account validity (`eduPersonAffiliation` = member,staff); empty = check disabled |
| `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_MODE` | LiteLLM proxy; `mock` only for dev/test |
| `SMTP_*`, `MAIL_FROM`, `ADMIN_NOTIFY_EMAILS` | Notifications |
| `KEY_LIFETIME_DAYS`, `DELETION_GRACE_DAYS`, `BUDGET_WARN_THRESHOLD` | Business rules |
| `DEV_LOGIN_ENABLED`, `IMPERSONATION_ENABLED` | Dev login (refused in production) and admin impersonation for debugging; both off by default |
| `API_DOCS_ADMIN_ONLY` | API docs only for signed-in admins; always on in production |
| `LOG_INGEST_CRON`, `JOBS_ENABLED` | How often request logs are fetched from LiteLLM (default every 5 minutes); jobs on one instance only |

## Commands

```bash
pnpm typecheck                 # all packages
pnpm test                      # Vitest (needs Postgres on :5433)
pnpm test:e2e                  # Playwright (API + UI); written for LITELLM_MODE=mock, see docs/SETUP.md 2.4
pnpm db:generate               # new migration from the Drizzle schema
pnpm --filter @api-selfservice/web build
docker build -t api-selfservice .     # production image (API + static web)
```

## Environments

The same image is used for dev, staging and prod. Differences only via env: Keycloak realm/client, LiteLLM URL/key, `DB_SCHEMA`, SMTP. Migrations are schema-independent; the schema is created on startup. Rollout steps, constraints and how to write migrations: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Security chain

Every route under `/api/v1` passes through: session (Better Auth) → CSRF (origin) → role guard → cost center scope → handler. Public are only `/health`, `/api/auth/*` (Better Auth; `/update-user` is disabled, names come from Keycloak) and, outside production, `/api/docs` and `/api/openapi.json`. LiteLLM is encapsulated behind `apps/api/src/litellm/`; the master key never leaves the backend, plaintext keys are never stored or logged (the key test turns every error into a generic code).

Because the portal talks to LiteLLM with one master key, it filters every response itself:

- Users see only their own keys and requests, admins included.
- Budget, spend and owner of a cost center are visible only to admins and that cost center's admins.
- The released models of a cost center are listed only to its members.
- LiteLLM error details go to the event log, never to the client.
- Owner e-mails in cost center requests are capped at 5 failed lookups per user and hour (`RATE_LIMITED`), so the user directory cannot be probed.
