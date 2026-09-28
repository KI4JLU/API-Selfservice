# API-Selfservice

Self-service portal for an existing LiteLLM proxy: Keycloak SSO, roles (user, cost center admin, admin), cost centers with approval workflow, budgets, API key self-service, request logger, reports, email notifications. Requirements: [docs/PRD.md](docs/PRD.md).

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

Details, manual steps and Keycloak setup: [docs/SETUP.md](docs/SETUP.md).

- API docs: http://localhost:3030/api/docs
- Mailpit (all mails): http://localhost:8025
- Login without Keycloak: dev login form on the login page (only when `DEV_LOGIN_ENABLED=true`, refused in production).
- Debugging as another user: with `IMPERSONATION_ENABLED=true`, admins can pick "Impersonate" in Users / roles and act as that user in their own session until they click Stop in the banner. Start and end are audited.
- Login with Keycloak (realm `api-selfservice-dev`, created by `pnpm keycloak:setup`): test users, password = `KC_TEST_USER_PASS` in `.env`.

  | User | Group | eduPersonAffiliation | Result |
  |---|---|---|---|
  | `admin-test` | LiteLLMAdmin | staff | Admin |
  | `user-test` | – | member | User |
  | `ext-test` | – | affiliate | Login rejected |

On startup the API creates the schema, runs migrations, seeds the default cost center `1111 1111` and syncs the models from LiteLLM.

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

## Commands

```bash
pnpm typecheck                 # all packages
pnpm test                      # Vitest (needs Postgres on :5433)
pnpm test:e2e                  # Playwright (API + UI)
pnpm db:generate               # new migration from the Drizzle schema
pnpm --filter @api-selfservice/web build
docker build -t api-selfservice .     # production image (API + static web)
```

## Environments

The same image is used for dev, staging and prod. Differences only via env: Keycloak realm/client, LiteLLM URL/key, `DB_SCHEMA`, SMTP. Migrations are schema-independent; the schema is created on startup. Rollout steps, constraints and how to write migrations: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Security chain

Every route under `/api/v1` passes through: session (Better Auth) → CSRF (origin) → role guard → cost center scope → handler. Only `/health`, `/api/auth/*`, `/api/docs` and `/api/openapi.json` are public. LiteLLM is encapsulated behind `apps/api/src/litellm/`; the master key never leaves the backend, plaintext keys are never stored.
