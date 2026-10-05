# Test key

Send a short prompt here to check that an API key works.

1. Paste the full **key** and click **Load models**. The list shows the models enabled for the key.
2. Pick a **model** and adjust the **prompt** if needed.
3. Click **Send**. On success you see the answer, the model, the duration and the tokens used.

The key is passed to LiteLLM for this test only and is not stored. The test request is billed to the key like any other request and shows up under **Usage**.

## Errors

| Message | Cause |
|---|---|
| Key rejected | The key is invalid, blocked, expired or not enabled for the model |
| Request failed | The model does not support chat (e.g. embedding, transcription) or the budget is used up |
