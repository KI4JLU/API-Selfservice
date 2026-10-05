# Key testen

Hier prüfen Sie mit einem kurzen Prompt, ob ein API-Key funktioniert.

1. Den vollständigen **Key** einfügen und **Modelle laden** klicken. Angezeigt werden die Modelle, die für den Key freigegeben sind.
2. Ein **Modell** wählen und den **Prompt** bei Bedarf anpassen.
3. **Senden** klicken. Bei Erfolg sehen Sie die Antwort, das Modell, die Dauer und die verbrauchten Tokens.

Der Key wird nur für den Test an LiteLLM weitergegeben und nicht gespeichert. Der Test-Request wird wie jeder andere Request über den Key abgerechnet und erscheint unter **Nutzung**.

## Fehler

| Meldung | Ursache |
|---|---|
| Key abgelehnt | Key ist ungültig, gesperrt, abgelaufen oder für das Modell nicht freigegeben |
| Request fehlgeschlagen | Modell unterstützt keinen Chat (z. B. Embedding, Transkription) oder das Budget ist erschöpft |
