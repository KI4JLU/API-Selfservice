# Admin: LiteLLM users

LiteLLM is the user master. This screen searches the accounts the LiteLLM proxy knows, including people who have never signed in to LiteLite.

## Search

- **E-mail**: partial, case-insensitive.
- **User ID**: the full LiteLLM user ID.
- Empty search lists all users page by page.

## Columns

- **User ID**, **e-mail** and **alias** as stored in LiteLLM.
- **Teams**: number of LiteLLM teams (= LiteLite cost centers) the user belongs to.
- **Spend** and **max budget** as enforced by LiteLLM.
- **In LiteLite**: the matching LiteLite account with its status, or "not yet signed in". An account that only exists in LiteLLM is adopted with the same ID on its first LiteLite login.

The list is read-only. Roles, budgets and deactivation are managed under Users / roles. The lookup needs a `LITELLM_API_KEY` with proxy admin rights.
