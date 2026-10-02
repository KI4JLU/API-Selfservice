# Admin: Users / roles

The user list shows all accounts with role, cost center, budget, spend, number of keys, status and last login.

## Filters

- **Search** by name or e-mail.
- Restrict by **cost center**.
- **Show deactivated**: deactivated users are hidden by default.

## Actions per user

- **Set role** (`user` / `admin`). If the admin role comes from the Keycloak group `LiteLLMAdmin`, it cannot be changed here. The last admin cannot be demoted.
- **Cost center admin for**: choose the cost centers for which the user may set the max budget and see reports. An empty selection removes the role.
- **Assign budget**: amount in EUR and period (monthly, yearly or project with start and end). The budget is synchronized to LiteLLM. At 100 % the user's keys are blocked.
- **Deactivate**: login and all keys are blocked, data stays for reports. **Reactivate** lifts the login block; keys stay blocked and must be recreated.
- **Impersonate** (only when enabled on this instance, for debugging): act as the selected user in your current session. You see and do exactly what that user can; your admin rights pause until you click **Stop impersonation** in the banner. Start, end and every action in between are audited (with you as `impersonatedBy`). Not possible for yourself or deactivated users.

Every change is written to the audit log and communicated to the user by e-mail.
