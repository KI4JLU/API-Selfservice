# Rollout and database migrations

How a new API-Selfservice version reaches an environment and how schema changes are applied. Local setup: [SETUP.md](SETUP.md). Keycloak: [keycloak.md](keycloak.md).

## 1. What gets deployed

One Docker image (`Dockerfile`) contains the API (`apps/api/src`, run as TypeScript through `tsx`), the built web app (served as static files from `apps/api/public`) and the migration files (`packages/db/drizzle`). The same image is used for dev, staging and production; the environment differs only in the variables from [.env.example](../../.env.example):

| Variable | Per environment |
|---|---|
| `DB_SCHEMA` | Own schema per environment on the shared LiteLLM Postgres host, e.g. `api_selfservice`, `api_selfservice_staging` |
| `DATABASE_URL` | Postgres of the LiteLLM host |
| `KEYCLOAK_*` | Realm and client of the environment |
| `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_MODE=http` | Proxy of the environment (`mock` is for dev/test only) |
| `APP_URL`, `API_URL` | Public URLs; used for CORS, CSRF origin check and mail links |
| `AUTH_SECRET` | Random, at least 32 characters, unique per environment |
| `SMTP_*`, `MAIL_FROM`, `ADMIN_NOTIFY_EMAILS` | Mail |
| `DEV_LOGIN_ENABLED`, `IMPERSONATION_ENABLED` | Must be `false` in production (`DEV_LOGIN_ENABLED=true` is refused when `NODE_ENV=production`) |
| `API_DOCS_ADMIN_ONLY` | `/api/docs` and `/api/openapi.json` only for signed-in admins. Always on with `NODE_ENV=production`; set `true` on environments that run without it |
| `JOBS_ENABLED` | `true` on exactly one instance (see 4.) |

## 2. What happens on startup

`apps/api/src/index.ts` runs, in this order, before the HTTP port is opened:

1. Load and validate env (`env.ts`); invalid config aborts the start.
2. `applyMigrations(db, DB_SCHEMA)`: create the schema if missing, apply all pending migrations (see 5.).
3. `seedBase(db)`: ensure the default cost center `1111 1111` exists (idempotent).
4. Sync the model list from LiteLLM (`syncProviders`); a failure is logged as a warning and does not abort the start.
5. Mirror cost center memberships that migrations wrote into the DB to the LiteLLM teams, once per database (`syncMigratedMembershipsOnce`, remembered in `job_state`); skipped while LiteLLM is unreachable and retried on the next start.
6. Start the cron jobs if `JOBS_ENABLED=true`.
7. Listen on `PORT`.

If step 1–3 fails, the process exits with code 1 and the log line `startup failed`. The old container keeps running when the orchestrator only replaces it after the new one is healthy.

Health check: `GET /health` returns `{ ok, litellm, mode, time }`. `ok` is `true` as soon as the API listens; `litellm` reflects the proxy reachability (checked with a 3 s timeout). The Docker `HEALTHCHECK` uses this endpoint (every 30 s).

## 3. Rollout steps

Build and test happen in CI (`.github/workflows/ci.yml`: typecheck, Vitest, Playwright, Docker build).

1. Build the image from the tagged commit: `docker build -t api-selfservice:<version> .`
2. Push it to the registry used by the environment.
3. Staging: point the deployment at the new tag and restart. Watch the log for `API-Selfservice API listening`; on `startup failed` the reason is in the same log entry.
4. Verify on staging: `GET /health` returns `ok: true` and `litellm: true`; login via Keycloak works; `/api/docs` opens for an admin (and returns 401 without a session).
5. Production: same as step 3 and 4.

Running `docker compose --profile app up -d` locally does the same with `.env` and the local Postgres.

### Existing Postgres host (`docker-compose.app.yml`)

`docker-compose.app.yml` runs only the API container and uses a Postgres that already exists, e.g. the LiteLLM host. Postgres 13 or newer (`gen_random_uuid()` is built in from 13 on, no extension needed).

1. On the Postgres host, as a superuser, create a login role for the app. Use the LiteLLM database or a separate one:

   ```sql
   create role api_selfservice login password '<strong password>';
   -- separate database (optional):
   create database api_selfservice owner api_selfservice;
   -- or the existing LiteLLM database:
   grant connect, create on database litellm to api_selfservice;
   ```

   `CREATE` on the database is enough: the API creates its schema (`DB_SCHEMA`) itself and owns it. It needs no rights on LiteLLM's tables in `public` (see 4.).

2. Optional: create the schema up front instead of granting `CREATE` on the database:

   ```sql
   create schema api_selfservice authorization api_selfservice;
   ```

3. Make the host reachable from the container. If Postgres runs on the Docker host, use `host.docker.internal` as host name and check:
   - `listen_addresses` in `postgresql.conf` includes an address reachable from the Docker network (not only `localhost`).
   - `pg_hba.conf` allows the Docker network, e.g. `host  litellm  api_selfservice  172.16.0.0/12  scram-sha-256`. Reload Postgres afterwards (`select pg_reload_conf();`).
   - The host firewall does not block traffic from the Docker networks (see Coolify pitfalls).

4. Set the connection in `.env`:

   ```env
   DATABASE_URL=postgres://api_selfservice:<password>@host.docker.internal:5432/litellm
   DB_SCHEMA=api_selfservice
   ```

   Special characters in the password must be URL-encoded. For TLS append `?sslmode=require`.

5. Test the connection from a container before starting the app:

   ```bash
   docker run --rm --add-host=host.docker.internal:host-gateway postgres:16-alpine \
     psql "$DATABASE_URL" -c 'select current_user, version();'
   ```

6. Start: `docker compose -f docker-compose.app.yml up -d --build`. On startup the API creates the schema, applies all migrations and seeds the default cost center (see 2.). Check the log for `API-Selfservice API listening` and the applied migrations with:

   ```sql
   select tag, applied_at from api_selfservice.__migrations order by applied_at;
   ```

Several environments (dev, staging) can share one host and database; give each its own `DB_SCHEMA`.

### Coolify

Current instance: application `apiselfservice` (project `Common`) on `cloud.safeaiplus.de`, repo `safeaiplus/litelite` @ `main`, domain `https://apiselfservice.safeaiplus.de`, Keycloak realm `api-selfservice-dev`.

**Setup**

- Build pack "Docker Compose" with compose file `/docker-compose.coolify.yml`. Do not use `docker-compose.yml`: that is the local dev stack, its `api` service only starts with `--profile app`, and it publishes Postgres (5433) and Mailpit (8025, 1025) on host ports.
- `docker-compose.coolify.yml` runs the API next to its own Postgres (service `apiselfservice-db`, volume `pgdata-coolify`) without host ports. Coolify generates `SERVICE_PASSWORD_POSTGRES`; `DATABASE_URL` is set in the compose file, the value in the Coolify UI is not used.
- Keep the DB service name unique. Coolify attaches services to a shared network; a plain `postgres` resolved to another app's database and queries failed intermittently with "password authentication failed".
- Domain on service `api`: `https://apiselfservice.safeaiplus.de` (no `www.`, it has no DNS record and breaks the certificate). The image exposes only port 3030, so the proxy routes there.
- Environment variables in Coolify: everything from section 1 except `DATABASE_URL`. `APP_URL` and `API_URL` = the public domain, `LITELLM_MODE=http`, `DEV_LOGIN_ENABLED=false`.
- Keycloak client `api-selfservice`: add `https://<host>/api/auth/callback/keycloak` (redirect URI), `https://<host>/*` (post logout redirect URI) and `https://<host>` (web origin), see [keycloak.md](keycloak.md). Without it Keycloak shows "Invalid parameter: redirect_uri".

**Deploy**

1. Push to `main`.
2. Coolify → `apiselfservice` → Deploy (or API: `POST /api/v1/deploy?uuid=<app uuid>`).
3. Check: Coolify status `running:healthy`; `GET https://<host>/health` returns `ok: true` and `litellm: true`; "Mit Keycloak anmelden" shows the Keycloak login form.

**Pitfalls seen during the first rollout**

- The image is built from a clean git checkout. Files that exist only locally are missing there (the root `.gitignore` once ignored every `docs/` folder, including `apps/web/src/docs`, and the web build failed). Check with `git archive origin/main | docker build -`.
- Containers must reach `keycloak.safeaiplus.de` and `litellm.safeaiplus.de`, which run on the same server. The host firewall blocked traffic from the Docker networks to the server's own public IP: Keycloak discovery failed at startup ("Provider skipped", login answered `PROVIDER_NOT_FOUND`) and LiteLLM calls timed out. Test on the server with `docker run --rm curlimages/curl -sS -m 5 https://keycloak.safeaiplus.de/realms/api-selfservice-dev/.well-known/openid-configuration`. The Keycloak configuration is loaded only at startup, so restart the app after fixing reachability.
- `/health` waits at most 3 s for LiteLLM; the container healthcheck times out after 5 s, and the proxy does not route to an unhealthy container (404/503 on the domain).

### Rollback

Deploy the previous image tag. This is safe as long as the migrations of the newer version are backward compatible (see 5.3); there is no automatic down migration.

## 4. Constraints

- **One instance per schema during a rollout.** The migrator does not take a lock. Two containers of a new version starting at the same time against the same `DB_SCHEMA` can both try to apply the same migration; the second one then fails with a duplicate-object error and exits. Replace instances one after the other, or run one instance.
- **Jobs on one instance only.** The cron jobs (log ingest, budget checks, key expiry, affiliation check) are not coordinated across instances. With several replicas set `JOBS_ENABLED=true` on one and `false` on the others.
- **Migrations run with the application's DB user.** That user needs `CREATE` on the database (for `CREATE SCHEMA`) and full rights on its own schema. It needs no access to the LiteLLM tables in `public`; all LiteLLM data (keys, models, spend logs) is read through the proxy's HTTP API.

## 5. Database migrations

### 5.1 How they work

- Source of truth is the Drizzle schema in `packages/db/src/schema.ts`. All tables live in the schema `pgSchema(DB_SCHEMA)`.
- Migrations are SQL files in `packages/db/drizzle/NNNN_<name>.sql`, listed in `packages/db/drizzle/meta/_journal.json`. They are generated by `drizzle-kit` but **applied by our own migrator** (`packages/db/src/migrate.ts`), not by `drizzle-kit migrate`.
- The generated SQL always references the schema `"api_selfservice"`. The migrator rewrites that name to the actual `DB_SCHEMA` at runtime, so one set of files serves every environment.
- Applied migrations are recorded in `<DB_SCHEMA>.__migrations (tag, applied_at)`. Each migration file runs in one transaction together with its journal entry: either the whole file is applied or nothing.
- The migrator runs on every API start (see 2.) and can also be run standalone: `pnpm db:migrate` (needs `DATABASE_URL` and `DB_SCHEMA` in the environment or `.env`).

### 5.2 Creating a migration

1. Change `packages/db/src/schema.ts`.
2. Generate the SQL: `pnpm db:generate`. Run it with `DB_SCHEMA` unset or set to `api_selfservice`; with any other value drizzle-kit writes a different schema name into the file and the runtime rewrite no longer matches.
3. Review the new file in `packages/db/drizzle/`. drizzle-kit does not know about data: add `UPDATE`/backfill statements by hand where a new `NOT NULL` column or a changed constraint needs them. Separate statements with `--> statement-breakpoint` like the generated ones.
4. Apply it locally by starting the API (`pnpm dev`) or `pnpm db:migrate`, then run `pnpm test` (the test setup drops and recreates `api_selfservice_test` from all migration files, so a broken file fails here).
5. Commit the SQL file **and** `meta/_journal.json` and `meta/NNNN_snapshot.json` together. Never edit or delete a migration that has been applied to staging or production; add a new one instead.

Check what is applied in an environment:

```sql
select tag, applied_at from <DB_SCHEMA>.__migrations order by applied_at;
```

### 5.3 Rules for production-safe migrations

Migrations run inside the new version's startup while the previous version may still be serving requests (rolling replacement) and while a rollback to that version must stay possible. Therefore:

- **Additive first.** Adding tables, columns (nullable or with default) and indexes is safe in one release.
- **Renames and drops in two releases.** Release A adds the new column/table and writes both; release B (after A is stable everywhere) drops the old one. The same applies to `NOT NULL` on existing columns: add nullable, backfill, then add the constraint in a later migration.
- **Avoid long locks.** `ALTER TABLE ... ADD COLUMN` with a constant default is fast on Postgres 11+; index creation on large tables should use `CREATE INDEX CONCURRENTLY` — this cannot run inside a transaction, so such a migration must be a file of its own containing only that statement, and the migrator's transaction wrapping will reject it. If that is needed, create the index manually before the rollout and let the migration be a no-op, or extend the migrator first.
- **No data deletion in a migration.** Data clean-up is a separate, reviewed step.

### 5.4 Failed migration

The API exits before listening; nothing is half-applied because each file runs in a transaction. Fix the SQL (or the data it stumbled over), build a new image and roll out again. The corrected file keeps its tag; it was never recorded in `__migrations`, so it is applied on the next start.

If a migration was applied but is wrong, write a new migration that corrects it. Do not remove the row from `__migrations` in production.

### 5.5 Migrations 0005 to 0009 (cost center members, owner, released models)

These migrations change how cost centers work (PRD E-9 to E-12). On an existing installation:

- `0005` adds `api_keys.providers` (keys that hold all models of a provider).
- `0006` creates `cost_center_members`: former cost center admins become admin members; users whose profile or keys point to a non-default cost center become plain members. `0007` drops the old `cost_center_admins` table.
- `0008` adds `cost_centers.owner_user_id` and links owners to existing users by e-mail; owners become admin members. Cost centers whose owner e-mail matches no user show "Owner missing" in Admin → Cost centers until an admin picks one.
- `0009` adds `cost_centers.models` (released models, empty = all) and `api_keys.budget_period` (monthly or none). Existing teams keep `models` empty until an admin releases models.
- On the first start after `0006`/`0008` the API mirrors the new memberships to the LiteLLM teams (step 5 in 2.). Check the event log for `litellm.sync_team_member` errors afterwards.
- **No rollback past `0007`.** It drops `cost_center_admins` in the same release that replaces it, against the rule in 5.3. An image older than these migrations no longer starts correctly on the migrated schema; take a database backup before rolling out to an environment that already has data.

### 5.6 Migration 0010 (join requests)

`0010` creates `cost_center_join_requests` (PRD F-KST-16, E-13). Additive only: no data is changed, and rolling back to the previous image leaves the table unused.

### 5.7 Resetting an environment (dev/staging only)

```sql
drop schema "<DB_SCHEMA>" cascade;
```

The next API start recreates the schema, applies all migrations and seeds the default cost center. Never do this in production; LiteLLM's own tables in `public` are not touched, but all API-Selfservice data (users, cost centers, key metadata, notifications, audit log) is gone.
