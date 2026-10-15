# API-Selfservice

Self-service portal for an existing LiteLLM proxy: Keycloak SSO, roles (user, cost center admin, admin), cost centers as LiteLLM teams with members, an owner and released models, budgets, API key self-service (single models or whole providers, monthly or one-off key budgets, key test), request logger, reports, email notifications, event log. Requirements: [docs/kb/PRD.md](docs/kb/PRD.md).

Cost centers in short: an admin creates a cost center and picks its owner (a LiteLLM user), who becomes its first cost center admin. Only the owner appoints or removes further cost center admins; all cost center admins add and remove members, one by one or as a pasted list of up to 200 e-mail addresses. Users find approved cost centers by name under "Cost centers" and ask to join; the cost center admins approve or reject the request. Members create keys on the cost center; plain members see its name only, never its budget, spend or owner.

## Stack

| Layer    | Technology                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend | React 19, TanStack Router/Query/Table, shadcn/ui components styled with tokens copied from the [JLU Design System](https://github.com/KI4JLU/Design-System), Tailwind 4, i18next (de/en) |
| Backend  | Hono + `@hono/zod-openapi`, Better Auth (Keycloak via generic-oauth), Drizzle ORM, Nodemailer, croner                                                                                    |
| Database | PostgreSQL, dedicated schema (`DB_SCHEMA`, default `api_selfservice`) on the LiteLLM DB host                                                                                             |
| Tests    | Vitest (unit/integration), Playwright (API + UI)                                                                                                                                         |

Structure: `apps/api`, `apps/web`, `packages/shared` (Zod schemas, i18n), `packages/db` (Drizzle schema, migrations), `e2e`.

## Running locally

```bash
pnpm setup:dev                  # .env, pnpm install, Postgres + Mailpit (Docker), migrations, seed
pnpm dev                        # API :3030, Web :5173
```

For local development set `LITELLM_MODE=mock` and `DEV_LOGIN_ENABLED=true` in `.env` (`.env.example` ships `http` and `false`). Details, manual steps, Keycloak and real-proxy setup: [docs/kb/SETUP.md](docs/kb/SETUP.md).

- API docs: http://localhost:3030/api/docs (in production only for signed-in admins)
- Mailpit (all mails): http://localhost:8025
- Login without Keycloak: dev login form on the login page (only when `DEV_LOGIN_ENABLED=true`, refused in production).
- Debugging as another user: with `IMPERSONATION_ENABLED=true`, admins can pick "Impersonate" in Users / roles and act as that user in their own session until they click Stop in the banner. Start, end and every action in between are audited (the admin as `impersonatedBy`).
- Login with Keycloak (realm `api-selfservice-dev`, created by `pnpm keycloak:setup`): test users, password = `KC_TEST_USER_PASS` in `.env`.

  | User         | Group        | eduPersonAffiliation | Result         |
  | ------------ | ------------ | -------------------- | -------------- |
  | `admin-test` | LiteLLMAdmin | staff                | Admin          |
  | `user-test`  | –            | member               | User           |
  | `ext-test`   | –            | affiliate            | Login rejected |

On startup the API creates the schema, runs migrations, seeds the default cost center `1111 1111`, syncs the models from LiteLLM and mirrors cost center memberships written by migrations to the LiteLLM teams once.

### Local LiteLLM

`pnpm litellm:up` starts LiteLLM (same version as production) with its own Postgres. Proxy and admin UI: http://localhost:4000 (`/ui`, user `admin`, password `sk-local-master`).

- Default config [docker/litellm/config.yaml](docker/litellm/config.yaml): models `local-gpt-4o-mini`, `local-gpt-4o` (priced) and `local-free`. They answer with a mock response, so no provider keys are needed, but LiteLLM still prices the tokens, writes spend logs and enforces budgets.
- Own config, e.g. the one from Coolify: save it as `docker/litellm/config.local.yaml` (gitignored) and start with `LITELLM_CONFIG=./docker/litellm/config.local.yaml pnpm litellm:up`. `AZURE_API_KEY` comes from the repo `.env`, other provider keys go into `docker/litellm/.env.local` (gitignored); Redis runs as `litellm-redis`. Real providers cost real money.
- App against the local proxy: `LITELLM_MODE=http`, `LITELLM_BASE_URL=http://localhost:4000`, `LITELLM_API_KEY=sk-local-master` in `.env`.
- Team admins are a LiteLLM Enterprise feature; without `LITELLM_LICENSE` cost center admins join their team as `user` (warning in the event log).

## Configuration

All settings are environment variables, see [.env.example](.env.example). Important ones:

| Variable                                                            | Meaning                                                                                                                                |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`, `DB_SCHEMA`                                         | Postgres of the LiteLLM host, dedicated schema                                                                                         |
| `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`   | OIDC client (see [docs/kb/keycloak.md](docs/kb/keycloak.md), automated via `scripts/keycloak-setup.mts`, see [docs/kb/SETUP.md](docs/kb/SETUP.md)) |
| `KEYCLOAK_ADMIN_GROUP`                                              | Group whose members are automatically admin (`LiteLLMAdmin`)                                                                           |
| `KEYCLOAK_AFFILIATION_CLAIM`, `KEYCLOAK_AFFILIATION_VALID`          | Account validity (`eduPersonAffiliation` = member,staff); empty = check disabled                                                       |
| `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_MODE`               | LiteLLM proxy; `mock` only for dev/test                                                                                                |
| `SMTP_*`, `MAIL_FROM`, `ADMIN_NOTIFY_EMAILS`                        | Notifications                                                                                                                          |
| `KEY_LIFETIME_DAYS`, `DELETION_GRACE_DAYS`, `BUDGET_WARN_THRESHOLD` | Business rules                                                                                                                         |
| `DEV_LOGIN_ENABLED`, `IMPERSONATION_ENABLED`                        | Dev login (refused in production) and admin impersonation for debugging; both off by default                                           |
| `API_DOCS_ADMIN_ONLY`                                               | API docs only for signed-in admins; always on in production                                                                            |
| `LOG_INGEST_CRON`, `JOBS_ENABLED`                                   | How often request logs are fetched from LiteLLM (default every 5 minutes); jobs on one instance only                                   |

## Commands

```bash
pnpm typecheck                 # all packages
pnpm test                      # Vitest (needs Postgres on :5433)
pnpm test:e2e                  # Playwright (API + UI) with LITELLM_MODE=mock and .env.test; stop pnpm dev first
pnpm litellm:up                # local LiteLLM proxy on :4000 (Docker, profile litellm), see below
pnpm test:e2e:local            # live suite against the local proxy with .env.test (pnpm test:e2e:live uses .env)
pnpm db:generate               # new migration from the Drizzle schema
pnpm --filter @api-selfservice/web build
docker build -t api-selfservice .     # production image (API + static web)
```

## Environments

The same image is used for dev, staging and prod. Differences only via env: Keycloak realm/client, LiteLLM URL/key, `DB_SCHEMA`, SMTP. Migrations are schema-independent; the schema is created on startup. Rollout steps, constraints and how to write migrations: [docs/kb/DEPLOYMENT.md](docs/kb/DEPLOYMENT.md).

## Running on an Ubuntu server

[docker-compose.app.yml](docker-compose.app.yml) runs the API and the web UI as one container (service `api`, port `3030`) against an existing Postgres. Tested setup: Ubuntu 22.04/24.04 with Docker Engine and the Compose plugin.

1. Install Docker (official repository, see [docs.docker.com/engine/install/ubuntu](https://docs.docker.com/engine/install/ubuntu/)):

   ```bash
   sudo apt-get update && sudo apt-get install -y ca-certificates curl git
   curl -fsSL https://get.docker.com | sudo sh
   sudo systemctl enable --now docker
   ```

2. Get the code and create the config:

   ```bash
   git clone <repo-url> /opt/api-selfservice && cd /opt/api-selfservice
   cp .env.example .env && chmod 600 .env
   ```

   Set at least `DATABASE_URL`, `DB_SCHEMA`, `AUTH_SECRET` (`openssl rand -base64 32`), `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_SECRET`, `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `SMTP_*`, and `APP_URL`/`API_URL` (the public URL). Postgres, SMTP or LiteLLM on the same server are reached as `host.docker.internal`, not `localhost`. Database setup: [docs/kb/DEPLOYMENT.md](docs/kb/DEPLOYMENT.md), "Existing Postgres host".

3. Build and start:

   ```bash
   sudo docker compose -f docker-compose.app.yml up -d --build
   ```

   The image is built on the server itself from the checked-out code; there is no registry. The build needs internet access (Docker Hub for `node:22-alpine`, the npm registry for `pnpm install`), about 2 GB RAM and a few GB of disk. Behind a proxy, set `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` in `.env` (see `.env.example`); compose passes them to the build. Docker Hub itself is pulled by the Docker daemon, which needs its own proxy setting ([docs.docker.com/engine/daemon/proxy](https://docs.docker.com/engine/daemon/proxy/)). The first build takes a few minutes; `docker image prune` removes old images after updates.

Service information:

| What           | Value / command                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Service        | `api` (compose project = directory name, e.g. `api-selfservice`)                                     |
| Port           | `3030` on the host (`PORT` in `.env`); put a reverse proxy with TLS (nginx, Caddy) in front of it    |
| Autostart      | `restart: unless-stopped` + `systemctl enable docker`: starts again after a crash or reboot          |
| Health         | `curl http://localhost:3030/health` → `ok: true`, `litellm: true`                                    |
| Status         | `sudo docker compose -f docker-compose.app.yml ps`                                                   |
| Logs           | `sudo docker compose -f docker-compose.app.yml logs -f api` (ready: `API-Selfservice API listening`) |
| Stop / start   | `sudo docker compose -f docker-compose.app.yml stop` / `start`                                       |
| Update         | `git pull && sudo docker compose -f docker-compose.app.yml up -d --build` (migrations run on start)  |
| Config changes | edit `.env`, then `sudo docker compose -f docker-compose.app.yml up -d` (recreates the container)    |

The Keycloak client needs the public URL as redirect URI (`https://<host>/api/auth/callback/keycloak`), see [docs/kb/keycloak.md](docs/kb/keycloak.md). Run only one container per `DB_SCHEMA` with `JOBS_ENABLED=true`.

## Security chain

Every route under `/api/v1` passes through: session (Better Auth) → CSRF (origin) → role guard → cost center scope → handler. Public are only `/health`, `/api/auth/*` (Better Auth; `/update-user` is disabled, names come from Keycloak) and, outside production, `/api/docs` and `/api/openapi.json`. LiteLLM is encapsulated behind `apps/api/src/litellm/`; the master key never leaves the backend, plaintext keys are never stored or logged (the key test turns every error into a generic code).

Because the portal talks to LiteLLM with one master key, it filters every response itself:

- Users see only their own keys and requests, admins included.
- Budget, spend and owner of a cost center are visible only to admins and that cost center's admins.
- The released models of a cost center are listed only to its members.
- LiteLLM error details go to the event log, never to the client.
- Owner e-mails in cost center requests are capped at 5 failed lookups per user and hour (`RATE_LIMITED`), so the user directory cannot be probed.
