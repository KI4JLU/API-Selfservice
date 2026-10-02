# Admin: Models

The list shows all models configured in LiteLLM.

## Tier

- **Free**: always available, billed to the default cost center `1111 1111`.
- **Paid**: only selectable with an approved cost center other than `1111 1111`.

New models appear as **paid** after synchronization until an admin changes the tier. Toggle the tier directly in the table.

## Provider

The provider comes from LiteLLM (`custom_llm_provider` or the prefix of the model, e.g. `openai/gpt-5`). Keys that use a whole provider get new models of that provider automatically. Models marked **No provider** are not added: add them in LiteLLM with a prefix and sync again. Azure models use the provider `azure`, not `openai`.

## Names

Use **Edit** to set a display name and a description per model in German and English. They are shown to users when creating keys.

## Synchronize

**Sync from LiteLLM** re-reads the model list. The result shows how many models are new, updated or no longer available. Models no longer present in LiteLLM are greyed out and cannot be chosen for new keys.
