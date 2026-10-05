# Welcome to LiteLite

LiteLite is the self-service portal for the LiteLLM proxy. Manage your API keys, check your budget and usage, and join cost centers.

## Sign-in

- You sign in with your university account (Keycloak, single sign-on). Your account is created automatically on first login.
- New accounts get the **User** role and the default cost center `1111 1111`.
- Members of the `LiteLLMAdmin` group are **Admin** automatically.

## Roles

| Role | Permissions |
|---|---|
| User | Own keys, own budget, own usage, own profile, request to join cost centers |
| Cost center admin | Additionally: members, join requests, max budget and report of assigned cost centers. Only the owner appoints further cost center admins |
| Admin | Everything: users, roles, budgets, cost centers (incl. released models and join requests), models, reports |

## Header

- **DE / EN** switches the language. Your choice is stored in your profile.
- **Sun / moon** toggles light and dark mode. The default follows your system setting.
- **?** opens this help. The section follows the screen you are on.
- The **user menu** leads to your profile and signs you out.
