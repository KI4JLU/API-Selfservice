# Setup

Step-by-step setup of a API-Selfservice environment. Local development uses the mock LiteLLM and the dev login and needs only steps 1 and 2. Keycloak (step 3) is required as soon as real SSO logins are needed.

## 1. Prerequisites

- Node.js 22+, pnpm 9+
- Docker (Postgres and Mailpit for local development)
- Node 22+ runs the Keycloak setup script directly (no build, no dependencies)

## 2. Local development

```bash
pnpm setup:dev                  # .env, pnpm install, Postgres + Mailpit (Docker), migrations, seed
pnpm dev                        # API :3030, Web :5173
```

The script is [`scripts/setup.mts`](../../scripts/setup.mts) (TypeScript, run directly by Node 22+). It is idempotent and safe to re-run at any time, for example after pulling new migrations. Steps:

1. **`.env`** – creates it from `.env.example` if missing, then loads it with Node's `process.loadEnvFile` (the app reads the same file).
2. **`pnpm install`** – installs all workspace dependencies.
3. **`docker compose up -d postgres mailpit`** – starts Postgres 16 (`localhost:5433`, database `litellm`, user/password `api_selfservice`) and Mailpit, then waits until Postgres is ready.
4. **`pnpm db:migrate`** – creates the schema from `DB_SCHEMA` (default `api_selfservice`) and applies the migrations in `packages/db/drizzle`.
5. **`pnpm db:seed`** – creates the default cost center `11111111`.

`.env.example` ships production-safe values (`LITELLM_MODE=http`, `DEV_LOGIN_ENABLED=false`); the script reminds you to change them. Values for local development:

| Variable | Local value | Meaning |
|---|---|---|
| `LITELLM_MODE` | `mock` | No LiteLLM needed, synthetic data. With `http` the app talks to a real proxy (see 4.) |
| `DEV_LOGIN_ENABLED` | `true` | Dev login form on the login page, refused in production |
| `IMPERSONATION_ENABLED` | `false` | Admins may act as another user for debugging (Users / roles → Impersonate); every action is audited with the admin as `impersonatedBy` |
| `API_DOCS_ADMIN_ONLY` | `false` | `true` puts `/api/docs` and `/api/openapi.json` behind an admin session; always on in production |
| `DATABASE_URL` | `postgres://api_selfservice:api_selfservice@localhost:5433/litellm` | Postgres from `docker-compose.yml` |
| `DB_SCHEMA` | `api_selfservice` | Schema for this app; tests use `api_selfservice_test` on the same Postgres |
| `SMTP_HOST`/`SMTP_PORT` | `localhost`/`1025` | Mailpit, web UI at http://localhost:8025 |

On startup the API also runs migrations and the seed, syncs the models and mirrors cost center memberships written by migrations to LiteLLM once, so after the first setup `pnpm dev` alone keeps the database current. API docs: http://localhost:3030/api/docs (public outside production).

### 2.1 Manual steps

The same steps without the script:

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres mailpit
set -a; source .env; set +a      # or export DATABASE_URL and DB_SCHEMA by hand
pnpm db:migrate
pnpm db:seed
```

Note: `source .env` trips over the unquoted cron values (`*/5 * * * *`) in zsh. Either quote them in your `.env` or use the script, which loads the file via Node.

### 2.2 Reset the database

Drops the `DB_SCHEMA` schema with all data and recreates it (asks for confirmation):

```bash
pnpm setup:dev --reset
```

Stop and remove the containers including the Postgres volume: `docker compose down -v`.

### 2.3 Useful checks

```bash
docker compose ps                                                    # container state
docker compose exec postgres psql -U api_selfservice -d litellm -c '\dn'    # schemas
docker compose exec postgres psql -U api_selfservice -d litellm -c '\dt api_selfservice.*'
docker compose exec postgres psql -U api_selfservice -d litellm -c 'select tag, applied_at from api_selfservice.__migrations'
```

New migration after a schema change in `packages/db/src/schema.ts`: `pnpm db:generate`, then re-run `pnpm setup:dev` (or start the API).

### 2.4 Tests

```bash
pnpm typecheck
pnpm test        # Vitest; drops and recreates the schema api_selfservice_test, never touches the dev schema
pnpm test:e2e    # Playwright; reuses the dev servers on :3030 and :5173 if they run, otherwise starts them
```

The E2E tests are written for `LITELLM_MODE=mock`. The API spec (`e2e/api`) also accepts `http`. Against a real proxy (`LITELLM_MODE=http`) every run creates test users, cost centers (LiteLLM teams) and keys there; remove them afterwards (LiteLLM `/key/delete`, `/team/delete`, `/user/delete`, then the rows in `DB_SCHEMA`).

## 3. Keycloak

What API-Selfservice expects on the Keycloak side (details in [keycloak.md](keycloak.md)):

- **Realm**: one dedicated realm per environment (e.g. `api-selfservice-dev`), never the master realm. API-Selfservice only uses OIDC discovery.
- **Client `api-selfservice`**: OpenID Connect, confidential, standard flow with PKCE S256, direct access grants off. Redirect URI `<API_URL>/api/auth/callback/keycloak`, post-logout redirect URI `<APP_URL>/*`, web origin `<APP_URL>`.
- **Group `LiteLLMAdmin`**: members become API-Selfservice admins on every login. A Group Membership mapper on the client must put the group into the ID token and userinfo as claim `groups` (full group path off).
- **User attribute `eduPersonAffiliation`**: multivalued user profile attribute (values such as `member`, `staff`, `student`) with a User Attribute mapper that adds it to the ID token and userinfo. Only users with an allowed value (default `member`, `staff`) may log in; if the attribute is not maintained, leave the allowed list empty and the check is skipped.
- **Optional client `api-selfservice-admin`**: service account only (all flows off) with the `realm-management` roles `view-users` and `query-groups`. Enables the nightly offboarding check against Keycloak.
- **Test users** (dev/staging only): an admin in `LiteLLMAdmin` with `staff`, a normal user with `member`, and a user with `affiliate` whose login must be rejected.

The full manual reference is [keycloak.md](keycloak.md). The script `scripts/keycloak-setup.mts` performs steps 1 to 5 and optionally 7 of that document and is idempotent, so it can be re-run. `pnpm keycloak:setup` runs it with the same arguments.

### 3.1 Configure `.env`

Set the target realm and client. The realm is taken from the issuer URL and is created if it does not exist.

```
KEYCLOAK_ISSUER=https://keycloak.safeaiplus.de/realms/api-selfservice-dev
KEYCLOAK_CLIENT_ID=api-selfservice
KEYCLOAK_ADMIN_GROUP=LiteLLMAdmin
KEYCLOAK_GROUPS_CLAIM=groups
KEYCLOAK_AFFILIATION_CLAIM=eduPersonAffiliation
KEYCLOAK_AFFILIATION_VALID=member,staff
```

`APP_URL` and `API_URL` from `.env` become the web origins and the redirect URI (`<API_URL>/api/auth/callback/keycloak`). Additional hosts are passed with `--extra-app-url` and `--extra-api-url`.

### 3.2 Provide admin credentials

The script logs in as an admin of the master realm. Fill in the block "Keycloak setup script only" in `.env` (see `.env.example`):

```
KC_ADMIN_USER=<admin username>
KC_ADMIN_PASS=<admin password>
KC_ADMIN_REALM=master
KC_TEST_USER_PASS=            # optional; when set, the test users get (or are reset to) this password on every run
```

Where to find the values: in the Keycloak deployment (Coolify) they are `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD`, usually filled from `SERVICE_USER_ADMIN` / `SERVICE_PASSWORD_ADMIN`. The bootstrap admin is temporary by design: create a permanent admin in the master realm once via the admin console and then remove the `KC_BOOTSTRAP_ADMIN_*` variables from the deployment.

The keys are only read by the script, never by the app. Exporting them in the shell instead of `.env` also works; the environment takes precedence.

### 3.3 Run the script

```bash
pnpm keycloak:setup --write-env
# with the service-account client for the nightly offboarding check:
pnpm keycloak:setup --write-env --admin-client
# staging with additional hosts:
pnpm keycloak:setup --write-env \
  --extra-app-url https://app.example.org --extra-api-url https://api.example.org
```

`pnpm keycloak:setup` is an alias for `node scripts/keycloak-setup.mts` (Node 22+, no build, no dependencies).

What it creates:

1. Realm from `KEYCLOAK_ISSUER`
2. Client `api-selfservice`: confidential, standard flow with PKCE S256, direct grants off, redirect URIs, post-logout URIs, web origins
3. Group `LiteLLMAdmin` and the `groups` mapper on the client
4. User profile attribute `eduPersonAffiliation` and its mapper
5. Test users `admin-test` (admin, staff), `user-test` (member), `ext-test` (affiliate, login must be rejected)
6. With `--admin-client`: client `api-selfservice-admin` with service account and roles `view-users`, `query-groups`

With `--write-env` the client secrets are written into `.env` (`KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_ADMIN_CLIENT_ID`, `KEYCLOAK_ADMIN_CLIENT_SECRET`). Without it they are printed. A generated test user password is printed once and not stored; set `KC_TEST_USER_PASS` in `.env` and re-run to reset the test users to a known password.

### 3.4 Verify

The script checks the discovery document at the end. Manually:

```bash
curl -s "$KEYCLOAK_ISSUER/.well-known/openid-configuration" | jq '{authorization_endpoint, token_endpoint, end_session_endpoint, code_challenge_methods_supported}'
```

Then set `DEV_LOGIN_ENABLED=false`, restart `pnpm dev`, and log in as `admin-test` (must land as admin), `user-test` (user) and `ext-test` (must be rejected).

### 3.5 Clean up

Clear `KC_ADMIN_PASS` in `.env` (or unset it in the shell). If a temporary admin account was created for the script, delete it. The `api-selfservice-admin` service account can only read users and groups, it cannot manage clients; that is intended.

## 4. LiteLLM

Set `LITELLM_MODE=http`, `LITELLM_BASE_URL` and `LITELLM_API_KEY` (master key). The key never leaves the backend.

What to know when running against a real proxy:

- **Users, teams, keys.** The portal uses LiteLLM as user master (same user id) and creates one LiteLLM team per approved cost center (`team_id` = cost center id). Members and cost center admins are team members with role `user` / `admin`. Released models of a cost center are written to the team's `models` (empty = all models), so LiteLLM enforces them for every key of the team.
- **Budgets.** Cost center budgets become team budgets, user budgets user budgets. Key budgets are either monthly (`budget_duration: 30d`; LiteLLM resets on the first of the month) or without a time window.
- **Requests appear with a delay.** LiteLLM writes spend logs a few seconds after a request, and the portal fetches them every 5 minutes (`LOG_INGEST_CRON`). Admins can trigger the fetch with `POST /api/v1/admin/jobs/ingest`.
- **Budget alerts.** Set up budget alerts in LiteLLM itself as well, in addition to the provider alerts, so overspending is noticed even if the portal is down.
- **Model aliases.** Named models in LiteLLM (e.g. Standard / Fast / Pro, Transcribe) let you swap the underlying model without touching keys.

## 5. Production image

```bash
docker build -t api-selfservice .
docker compose --profile app up -d     # uses .env, API + static web on :3030
```

The same image is used for all environments. Differences are only in the environment: Keycloak realm and client, LiteLLM URL and key, `DB_SCHEMA`, SMTP. `DEV_LOGIN_ENABLED=true` is refused when `NODE_ENV=production`. Rollout and migrations: [DEPLOYMENT.md](DEPLOYMENT.md).
