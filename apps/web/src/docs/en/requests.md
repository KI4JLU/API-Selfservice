# Requests

The request list shows your own requests to the LiteLLM proxy, taken 1:1 from the LiteLLM logs. Other users, including admins, cannot see your requests.

## Columns

Time, type, status, model, key, cost, duration (s), TTFT (s, time to first token), tokens (input + output) and tags.

## Filters

- **Date range** (from/to), **model**, **key** and **status** (success / failure).
- **Request ID**: exact search for a request ID, e.g. from an error message in your client.
- The list is paginated; use the buttons at the bottom.

## Details

Click a row to open the detail view with all fields, including request ID, session ID and the error message of failed requests.

Prompt and response contents are **not** stored or shown, only metadata.

## Delay

New requests show up after a few minutes: LiteLLM writes its logs shortly after the request, and the portal fetches them every 5 minutes. A key you just tested is therefore not in the list right away.
