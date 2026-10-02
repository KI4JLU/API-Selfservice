# API-Keys

Hier legen Sie Keys für den LiteLLM-Proxy an und verwalten sie.

## Key anlegen

1. **Neuen Key anlegen** klicken.
2. Einen **Namen** vergeben (z. B. „Notebook Projekt X“).
3. Die **Kostenstelle** wählen. Vorbelegt ist Ihre aktuelle Kostenstelle. Wählbar sind die Default-Kostenstelle und die Kostenstellen, deren Mitglied Sie sind. Mitglied werden Sie über einen Kostenstellen-Admin.
4. Ein oder mehrere **Modelle** wählen. Modelle der Klasse **kostenpflichtig** sind nur mit einer Kostenstelle ungleich `1111 1111` wählbar; **kostenfreie** Modelle sind immer verfügbar.
   Im Reiter **Provider** wählen Sie stattdessen ganze Provider: Der Key erhält alle aktuellen Modelle des Providers, neue Modelle kommen nach dem nächsten Provider-Abgleich automatisch hinzu. Auch hier gilt: Auf `1111 1111` kommen nur kostenfreie Modelle dazu.
5. Optional ein **Key-Budget** setzen. Die Summe aller Key-Budgets darf Ihr User-Budget nicht überschreiten. Unter **Zeitfenster** wählen Sie **Monatlich** (das Budget gilt pro Kalendermonat und startet danach neu) oder **Ohne Zeitfenster** (das Budget gilt einmal für die ganze Laufzeit des Keys). Bei monatlichem Budget zeigt die Liste den Verbrauch des laufenden Monats.

Nach dem Anlegen wird der Key **genau einmal** im Klartext angezeigt. Kopieren Sie ihn sofort; danach ist nur noch die maskierte Form sichtbar.

## Ablauf und Verlängerung

- Jeder Key läuft **6 Monate** nach Erstellung ab. 14 Tage und 1 Tag vorher erhalten Sie eine E-Mail.
- Abgelaufene Keys werden gesperrt, nicht gelöscht. Mit **Verlängern** setzen Sie die Laufzeit um weitere 6 Monate ab jetzt; der Key selbst bleibt unverändert.

## Löschen

**Löschen** entfernt den Key dauerhaft aus LiteLLM. Der bisherige Verbrauch bleibt in Reports erhalten.

## Status

| Status | Bedeutung |
|---|---|
| Aktiv | Key ist nutzbar |
| Abgelaufen | Laufzeit vorbei, verlängern möglich |
| Gesperrt | Budget erschöpft oder Account deaktiviert |
