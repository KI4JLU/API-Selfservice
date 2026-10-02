# API keys

Create and manage keys for the LiteLLM proxy.

## Create a key

1. Click **Create key**.
2. Enter a **name** (e.g. "Notebook project X").
3. Choose the **cost center**. Your current cost center is preselected. You can choose the default cost center and the cost centers you are a member of. A cost center admin adds you as a member.
4. Select one or more **models**. Models of the **paid** tier require a cost center other than `1111 1111`; **free** models are always available.
   In the **Providers** tab you select whole providers instead: the key gets all current models of the provider, and new models are added automatically after the next provider sync. The same rule applies: on `1111 1111` only free models are added.
5. Optionally set a **key budget**. The sum of all key budgets must not exceed your user budget. Under **Time window** choose **Monthly** (the budget applies per calendar month and starts again afterwards) or **No time window** (the budget applies once for the key's whole lifetime). For monthly budgets the list shows the spend of the current month.

After creation the key is shown **exactly once** in plain text. Copy it right away; afterwards only the masked form is visible.

## Expiry and extension

- Every key expires **6 months** after creation. You get an e-mail 14 days and 1 day before.
- Expired keys are blocked, not deleted. **Extend** sets a new 6-month lifetime starting now; the key itself stays the same.

## Delete

**Delete** removes the key permanently from LiteLLM. Its past usage stays in reports.

## Status

| Status | Meaning |
|---|---|
| Active | Key can be used |
| Expired | Lifetime over, can be extended |
| Blocked | Budget exhausted or account deactivated |
