# Admin: Modelle

Die Liste zeigt alle in LiteLLM konfigurierten Modelle, gruppiert nach Provider und darin nach Modellname sortiert. Ein Klick auf die Gruppenzeile klappt den Provider ein oder aus; die Zahl daneben ist die Anzahl der Modelle. Modelle ohne Provider stehen unter **Kein Provider** am Ende.

## Klasse

- **Kostenfrei**: immer verfügbar, läuft über die Default-Kostenstelle `1111 1111`.
- **Kostenpflichtig**: nur mit einer freigegebenen Kostenstelle ungleich `1111 1111` wählbar.

Neue Modelle erscheinen nach der Synchronisation automatisch als **kostenpflichtig**, bis ein Admin sie umstuft. Die Klasse schalten Sie direkt in der Tabelle um.

## Provider

Der Provider stammt aus LiteLLM (`custom_llm_provider` oder Präfix im Modell, z. B. `openai/gpt-5`). Keys, die einen ganzen Provider nutzen, erhalten neue Modelle dieses Providers automatisch. Modelle mit **Kein Provider** kommen nicht dazu: Tragen Sie sie in LiteLLM mit Präfix ein und synchronisieren Sie neu. Azure-Modelle laufen unter dem Provider `azure`, nicht `openai`.

## Bezeichnungen

Mit **Bearbeiten** oder einem Klick auf den Modellnamen hinterlegen Sie pro Modell einen Anzeigenamen und eine Beschreibung in Deutsch und Englisch. Sie werden Usern bei der Key-Erstellung angezeigt.

## Synchronisieren

**Aus LiteLLM synchronisieren** liest die Modellliste neu ein. Das Ergebnis zeigt, wie viele Modelle neu, aktualisiert oder nicht mehr verfügbar sind. Nicht mehr in LiteLLM vorhandene Modelle werden ausgegraut und können nicht mehr für neue Keys gewählt werden.
