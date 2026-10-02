# Admin: Notifications

Every e-mail sent is logged with recipient, type, subject, timestamp and status.

## Filters

- **Type**: e.g. cost center request, budget 80 % / 100 %, key expiring, role changed.
- **Status**: `sent`, `failed` (with error message) or `skipped`.

## Typical events

| Event | Recipient |
|---|---|
| Cost center request received | Admins |
| Request approved / rejected | User |
| User budget 80 % / 100 % | User |
| Cost center budget 80 % / 100 % | Owner, cost center admins |
| Key expires in 14 days / 1 day, key expired | User |
| Role changed, account deactivated | Affected user |
