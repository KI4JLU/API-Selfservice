# Setting up Keycloak

Applies to `keycloak.safeaiplus.de` (dev/staging) and the customer's Keycloak (prod). API-Selfservice only uses OIDC discovery, so one realm and one client per environment is enough.

Steps 1–5 and 7 can be automated with `scripts/keycloak-setup.mts` (reads `.env`, needs `KC_ADMIN_USER`/`KC_ADMIN_PASS`; `--write-env` stores the client secret, `--admin-client` adds step 7). The manual steps below remain the reference.

## Overview

- **Realm**: one dedicated realm per environment (e.g. `api-selfservice-dev`), never the master realm. API-Selfservice only uses OIDC discovery.
- **Client `api-selfservice`**: OpenID Connect, confidential, standard flow with PKCE S256, direct access grants off. Redirect URI `<API_URL>/api/auth/callback/keycloak`, post-logout redirect URI `<APP_URL>/*`, web origin `<APP_URL>`.
- **Group `LiteLLMAdmin`**: members become API-Selfservice admins on every login. A Group Membership mapper on the client must put the group into the ID token and userinfo as claim `groups` (full group path off).
- **User attribute `eduPersonAffiliation`**: multivalued user profile attribute (values such as `member`, `staff`, `student`) with a User Attribute mapper that adds it to the ID token and userinfo. Only users with an allowed value (default `member`, `staff`) may log in; if the attribute is not maintained, leave the allowed list empty and the check is skipped.
- **Optional client `api-selfservice-admin`**: service account only (all flows off) with the `realm-management` roles `view-users` and `query-groups`. Enables the nightly offboarding check against Keycloak.
- **Test users** (dev/staging only): an admin in `LiteLLMAdmin` with `staff`, a normal user with `member`, and a user with `affiliate` whose login must be rejected.

## 1. Realm

`api-selfservice-dev` (or `api-selfservice-staging`). Do not use the master realm.

## 2. Client `api-selfservice`

| Setting | Value |
|---|---|
| Client type | OpenID Connect |
| Client authentication | On (confidential) |
| Standard flow | On, PKCE Method `S256` (Advanced → Proof Key for Code Exchange) |
| Direct access grants | Off |
| Valid redirect URIs | `http://localhost:3030/api/auth/callback/keycloak` (dev), `https://<api-host>/api/auth/callback/keycloak` |
| Valid post logout redirect URIs | `http://localhost:5173/*`, `https://<app-host>/*` (Better Auth sends `APP_URL` with a trailing slash, e.g. `http://localhost:5173/`; without the wildcard Keycloak answers "Invalid redirect uri" on logout) |
| Web origins | `http://localhost:5173`, `https://<app-host>` |

Put the client secret from the "Credentials" tab into `KEYCLOAK_CLIENT_SECRET`.

Realm `api-selfservice-dev` currently also serves the Coolify instance: `https://apiselfservice.safeaiplus.de` is entered as redirect URI (`/api/auth/callback/keycloak`), post logout redirect URI (`/*`) and web origin. Add these three entries for every new host; `scripts/keycloak-setup.mts --extra-app-url <url> --extra-api-url <url>` does it, but it also syncs mappers and test users.

The callback path is the Better Auth core endpoint `/api/auth/callback/<providerId>` (provider ID `keycloak`).

## 3. Group `LiteLLMAdmin`

Realm → Groups → create `LiteLLMAdmin`. Members become admin in API-Selfservice on every login.

To get the group into the ID token: client `api-selfservice` → Client scopes → `api-selfservice-dedicated` → Add mapper → By configuration → **Group Membership**:

| Field | Value |
|---|---|
| Name | groups |
| Token Claim Name | `groups` (= `KEYCLOAK_GROUPS_CLAIM`) |
| Full group path | Off |
| Add to ID token | On |
| Add to userinfo | On |

## 4. Attribute `eduPersonAffiliation`

Realm → Realm settings → User profile → Create attribute `eduPersonAffiliation` (multivalued allowed, values e.g. `member`, `staff`, `student`).

Mapper as above, type **User Attribute**: User Attribute `eduPersonAffiliation`, Token Claim Name `eduPersonAffiliation`, Multivalued On, Add to ID token On, Add to userinfo On.

`KEYCLOAK_AFFILIATION_VALID=member,staff`. Leave empty if the attribute is not maintained (yet); the validity check is then skipped.

## 5. Test users

| User | Group | eduPersonAffiliation | Expected |
|---|---|---|---|
| `admin-test` | LiteLLMAdmin | staff | Admin |
| `user-test` | – | member | User |
| `ext-test` | – | affiliate | Login rejected (account invalid) |

## 6. Env

```
KEYCLOAK_ISSUER=https://keycloak.safeaiplus.de/realms/api-selfservice-dev
KEYCLOAK_CLIENT_ID=api-selfservice
KEYCLOAK_CLIENT_SECRET=<secret>
KEYCLOAK_ADMIN_GROUP=LiteLLMAdmin
KEYCLOAK_GROUPS_CLAIM=groups
KEYCLOAK_AFFILIATION_CLAIM=eduPersonAffiliation
KEYCLOAK_AFFILIATION_VALID=member,staff
```

Verify: `curl https://keycloak.safeaiplus.de/realms/api-selfservice-dev/.well-known/openid-configuration` must return `authorization_endpoint`, `token_endpoint`, `end_session_endpoint` and `S256`.

## 7. Optional: admin client for the offboarding process

Without this client the nightly job only checks the claims captured at the last login. With it, all active users are checked against Keycloak daily (exists, enabled, attribute, group).

Client `api-selfservice-admin`: Client authentication On, Service accounts roles On, all flows Off. Tab "Service account roles" → Assign role → Filter by clients → `realm-management` → `view-users` (and `query-groups`).

```
KEYCLOAK_ADMIN_CLIENT_ID=api-selfservice-admin
KEYCLOAK_ADMIN_CLIENT_SECRET=<secret>
```
