# Admin: Event log

Every major change, every alert and every failure is logged with time, object and the person who triggered it. The log is written by the server; entries cannot be edited or deleted.

## Severity

- **Info**: a change, e.g. user created, key created, budget assigned, cost center approved, role changed, models synced.
- **Alert**: something needs attention, e.g. a user or cost center budget reached 80 % or is exhausted (keys blocked), an account was deactivated because it is no longer entitled.
- **Error**: something failed, e.g. a change could not be mirrored to LiteLLM, a cron job failed, or an API request ended in an internal error.

## Filters

- **Severity** and **Object** (user, API key, cost center, model, request, job).
- **Event**: substring of the technical event name, e.g. `key.create`, `budget` or `litellm`.

## Details

Click a row to see the object ID and the recorded details (e.g. amounts and percentages for budget alerts, the error message for failures). Entries with **Triggered by** = *System* were produced by cron jobs or budget checks, not by a person. When an admin acted as another user (impersonation), that user is shown under **Triggered by** and the admin's ID is in the details as `impersonatedBy`. LiteLLM errors are recorded here in full; users only see a generic message.

## Common events

| Event | Meaning |
|---|---|
| `user.create` | A user signed in for the first time (created or adopted from LiteLLM) |
| `key.create` / `key.delete` / `key.extend` / `key.expire` | Key lifecycle |
| `key.models_added` | New models of a provider were added to a provider key automatically |
| `budget.set` | Admin assigned a user budget |
| `budget.warn` / `budget.block` | User budget at 80 % / exhausted, keys blocked |
| `cost_center.warn` / `cost_center.block` | Cost center budget at 80 % / exhausted, keys blocked |
| `cost_center.join_request` / `cost_center.join_approve` / `cost_center.join_reject` | Join to a cost center requested / approved / rejected |
| `user.set_role` / `user.deactivate` | Role changed / user deactivated |
| `litellm.*` | Mirroring a change to LiteLLM failed; the change is kept in LiteLite and retried on the next sync |
| `job.failed` / `request.internal_error` | A cron job or an API request failed unexpectedly |
